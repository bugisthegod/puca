import { describe, expect, test } from "bun:test";
import {
  escapeHtml,
  fmtTime,
  isLiveRunningTrain,
  isInServiceHours,
  isTrainLiveDataUnavailable,
  markerColor,
  parseLateMinutes,
  parseRoute,
  trainCategory,
} from "../src/utils";
import type { Train } from "../src/types";

describe("parseLateMinutes", () => {
  test("'on time' returns 0 (case-insensitive, position-insensitive)", () => {
    expect(parseLateMinutes("on time")).toBe(0);
    expect(parseLateMinutes("On Time")).toBe(0);
    expect(parseLateMinutes("Currently on time at Heuston")).toBe(0);
  });

  test("(N mins late) form returns N", () => {
    expect(parseLateMinutes("(3 mins late)")).toBe(3);
    expect(parseLateMinutes("(15 mins late)")).toBe(15);
  });

  test("singular 'min' is accepted alongside 'mins'", () => {
    expect(parseLateMinutes("(1 min late)")).toBe(1);
  });

  test("negative is parsed as early — drives green marker, not red", () => {
    expect(parseLateMinutes("(-1 mins late)")).toBe(-1);
    expect(parseLateMinutes("(-5 mins late)")).toBe(-5);
  });

  test("'Departed X N late' fallback when message lacks the 'mins' word", () => {
    expect(parseLateMinutes("Departed Connolly 5 late")).toBe(5);
    expect(parseLateMinutes("Arrived Howth 2 late")).toBe(2);
  });

  test("returns null when no timing info is present", () => {
    expect(parseLateMinutes("")).toBeNull();
    expect(parseLateMinutes("Train cancelled")).toBeNull();
    expect(parseLateMinutes("Running")).toBeNull();
  });
});

describe("parseRoute", () => {
  test("extracts origin/destination from a typical PublicMessage", () => {
    const msg = "E123\n08:30 - Connolly to Howth (DART) - currently on time";
    expect(parseRoute(msg)).toEqual({ origin: "Connolly", destination: "Howth" });
  });

  test("trims surrounding whitespace from station names", () => {
    const msg = "P101\n14:00 -   Heuston   to   Cork   (Intercity)";
    expect(parseRoute(msg)).toEqual({ origin: "Heuston", destination: "Cork" });
  });

  test("supports multi-word station names", () => {
    const msg = "A1\n09:45 - Dublin Connolly to Belfast Lanyon Place (Enterprise)";
    expect(parseRoute(msg)).toEqual({ origin: "Dublin Connolly", destination: "Belfast Lanyon Place" });
  });

  test("returns null when the format does not match", () => {
    expect(parseRoute("")).toBeNull();
    expect(parseRoute("just some text")).toBeNull();
    expect(parseRoute("Connolly to Howth")).toBeNull(); // missing HH:MM and the trailing "("
  });
});

describe("markerColor", () => {
  function train(status: Train["status"], message: string): Train {
    return { code: "X", lat: 0, lng: 0, status, message, direction: "", date: "" };
  }

  test("status N (not yet running) is gray regardless of message", () => {
    expect(markerColor(train("N", "(2 mins late)"))).toBe("#9e9e9e");
  });

  test("status T (terminated) is gray regardless of message", () => {
    expect(markerColor(train("T", "(2 mins late)"))).toBe("#9e9e9e");
  });

  test("running on-time is green", () => {
    expect(markerColor(train("R", "on time"))).toBe("#4caf50");
  });

  test("running early is green", () => {
    expect(markerColor(train("R", "(-2 mins late)"))).toBe("#4caf50");
  });

  test("1–5 min late is orange (boundaries inclusive at 1 and 5)", () => {
    expect(markerColor(train("R", "(1 min late)"))).toBe("#ff9800");
    expect(markerColor(train("R", "(5 mins late)"))).toBe("#ff9800");
  });

  test(">5 min late is red (boundary exclusive at 5)", () => {
    expect(markerColor(train("R", "(6 mins late)"))).toBe("#f44336");
    expect(markerColor(train("R", "(20 mins late)"))).toBe("#f44336");
  });

  test("running with unparseable message is gray, not falsely-green", () => {
    // Lateness unknown → must NOT default to "on time" green; that would lie to the user.
    expect(markerColor(train("R", "Train cancelled"))).toBe("#9e9e9e");
  });
});

describe("trainCategory", () => {
  test("E prefix is DART", () => {
    expect(trainCategory("E101")).toBe("dart");
    expect(trainCategory("E001")).toBe("dart");
  });

  test("P prefix is commuter", () => {
    expect(trainCategory("P530")).toBe("commuter");
  });

  test("anything else is intercity", () => {
    expect(trainCategory("A001")).toBe("intercity");
    expect(trainCategory("D123")).toBe("intercity");
    expect(trainCategory("")).toBe("intercity");
  });
});

describe("train live data health", () => {
  const liveNow = new Date("2026-05-10T17:40:00Z"); // 18:40 in Dublin summer time

  function train(overrides: Partial<Train>): Train {
    return {
      code: "E117",
      lat: 53.2,
      lng: -6.1,
      status: "R",
      message: "E117\n18:33 - Malahide to Greystones (2 mins late)",
      direction: "Southbound",
      date: "10 May 2026",
      ...overrides,
    };
  }

  test("counts today's plausible R train as live", () => {
    expect(isLiveRunningTrain(train({}), liveNow)).toBe(true);
    expect(isTrainLiveDataUnavailable([train({})], liveNow)).toBe(false);
  });

  test("treats previous-day ghost R trains as unavailable live data", () => {
    const ghost = train({
      date: "09 May 2026",
      message: "E117\n22:33 - Malahide to Greystones (1442 mins late)",
    });

    expect(isLiveRunningTrain(ghost, liveNow)).toBe(false);
    expect(isTrainLiveDataUnavailable([ghost], liveNow)).toBe(true);
  });

  test("does not warn during normal off-hours", () => {
    const offHours = new Date("2026-05-09T02:00:00Z");
    expect(isTrainLiveDataUnavailable([], offHours)).toBe(false);
  });
});

describe("fmtTime", () => {
  test("empty string yields the em-dash placeholder", () => {
    expect(fmtTime("")).toBe("—");
  });

  test("HH:MM passes through unchanged", () => {
    expect(fmtTime("08:30")).toBe("08:30");
  });

  test("HH:MM:SS gets seconds clipped", () => {
    expect(fmtTime("08:30:45")).toBe("08:30");
  });
});

describe("isInServiceHours", () => {
  // Construct UTC dates that map to known Europe/Dublin local times.
  // Winter (Jan): Dublin = UTC+0, so UTC X:Y = Dublin X:Y.
  // Summer (Jul): Dublin = UTC+1 (IST), so UTC (X-1):Y = Dublin X:Y.
  function dublinWinter(hh: number, mm: number): Date {
    const h = String(hh).padStart(2, "0");
    const m = String(mm).padStart(2, "0");
    return new Date(`2024-01-15T${h}:${m}:00Z`);
  }
  function dublinSummer(hh: number, mm: number): Date {
    const totalMins = (hh * 60 + mm - 60 + 1440) % 1440;
    const uh = String(Math.floor(totalMins / 60)).padStart(2, "0");
    const um = String(totalMins % 60).padStart(2, "0");
    return new Date(`2024-07-15T${uh}:${um}:00Z`);
  }

  describe("train (in service 05:00 – 00:00)", () => {
    test("midday is in service", () => {
      expect(isInServiceHours("train", dublinWinter(12, 0))).toBe(true);
    });
    test("23:59 is in service (just before nightly cutoff)", () => {
      expect(isInServiceHours("train", dublinWinter(23, 59))).toBe(true);
    });
    test("00:00 closes the window", () => {
      expect(isInServiceHours("train", dublinWinter(0, 0))).toBe(false);
    });
    test("04:59 is still off-hours", () => {
      expect(isInServiceHours("train", dublinWinter(4, 59))).toBe(false);
    });
    test("05:00 reopens the window", () => {
      expect(isInServiceHours("train", dublinWinter(5, 0))).toBe(true);
    });
  });

  describe("bus (in service 05:00 – 00:00)", () => {
    test("04:59 is off-hours", () => {
      expect(isInServiceHours("bus", dublinWinter(4, 59))).toBe(false);
    });
    test("05:00 opens the window", () => {
      expect(isInServiceHours("bus", dublinWinter(5, 0))).toBe(true);
    });
    test("23:59 is in service (just before nightly cutoff)", () => {
      expect(isInServiceHours("bus", dublinWinter(23, 59))).toBe(true);
    });
    test("00:00 closes the window", () => {
      expect(isInServiceHours("bus", dublinWinter(0, 0))).toBe(false);
    });
    test("00:00 is off-hours (no overnight bus)", () => {
      expect(isInServiceHours("bus", dublinWinter(0, 0))).toBe(false);
    });
  });

  describe("DST: Dublin local time decides, not UTC", () => {
    // The whole reason isInServiceHours formats through Europe/Dublin instead
    // of reading getHours() — without that, summer answers would be off by 1h.
    test("Dublin 05:00 is in service for both modes in Jan and Jul", () => {
      expect(isInServiceHours("train", dublinWinter(5, 0))).toBe(true);
      expect(isInServiceHours("train", dublinSummer(5, 0))).toBe(true);
      expect(isInServiceHours("bus", dublinWinter(5, 0))).toBe(true);
      expect(isInServiceHours("bus", dublinSummer(5, 0))).toBe(true);
    });
    test("Dublin 04:59 is off-hours for both modes in Jan and Jul", () => {
      expect(isInServiceHours("train", dublinWinter(4, 59))).toBe(false);
      expect(isInServiceHours("train", dublinSummer(4, 59))).toBe(false);
      expect(isInServiceHours("bus", dublinWinter(4, 59))).toBe(false);
      expect(isInServiceHours("bus", dublinSummer(4, 59))).toBe(false);
    });
  });
});

describe("escapeHtml", () => {
  test("ampersand is escaped first so subsequent escapes do not double-mangle", () => {
    // Order matters: if "<" were escaped before "&", "&lt;" would corrupt the
    // literal sequence we just wrote. Escaping & first preserves it.
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("&lt;")).toBe("&amp;lt;"); // pre-encoded entity becomes a literal
  });

  test("each XSS sigil maps to its named entity", () => {
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  test("a typical script payload is fully neutralized", () => {
    const payload = `<script>alert('x')</script>`;
    expect(escapeHtml(payload)).toBe(`&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;`);
  });

  test("empty string and plain ascii pass through unchanged", () => {
    expect(escapeHtml("")).toBe("");
    expect(escapeHtml("Connolly Station")).toBe("Connolly Station");
  });
});
