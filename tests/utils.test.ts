import { describe, expect, test } from "bun:test";
import type { Train } from "../src/types";
import {
	escapeHtml,
	fmtTime,
	isInServiceHours,
	markerColor,
	parseLateMinutes,
	parseRoute,
	parseTrainProgress,
} from "../src/utils";

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
		expect(parseRoute(msg)).toEqual({
			origin: "Connolly",
			destination: "Howth",
		});
	});

	test("trims surrounding whitespace from station names", () => {
		const msg = "P101\n14:00 -   Heuston   to   Cork   (Intercity)";
		expect(parseRoute(msg)).toEqual({ origin: "Heuston", destination: "Cork" });
	});

	test("supports multi-word station names", () => {
		const msg =
			"A1\n09:45 - Dublin Connolly to Belfast Lanyon Place (Enterprise)";
		expect(parseRoute(msg)).toEqual({
			origin: "Dublin Connolly",
			destination: "Belfast Lanyon Place",
		});
	});

	test("returns null when the format does not match", () => {
		expect(parseRoute("")).toBeNull();
		expect(parseRoute("just some text")).toBeNull();
		expect(parseRoute("Connolly to Howth")).toBeNull(); // missing HH:MM and the trailing "("
	});
});

describe("parseTrainProgress", () => {
	test("extracts departed/current and next stop from PublicMessage", () => {
		const msg =
			"E848\\n22:42 - Bray to Malahide (1 mins late)\\nDeparted Kilbarrack next stop Howth Junction";
		expect(parseTrainProgress(msg)).toEqual({
			kind: "departed",
			currentStation: "Kilbarrack",
			nextStation: "Howth Junction",
		});
	});

	test("extracts arrived/current and next stop from PublicMessage", () => {
		const msg =
			"E703\n23:40 - Malahide to Dublin Connolly (0 mins late)\nArrived Portmarnock next stop Clongriffin";
		expect(parseTrainProgress(msg)).toEqual({
			kind: "arrived",
			currentStation: "Portmarnock",
			nextStation: "Clongriffin",
		});
	});

	test("returns null when progress line is missing", () => {
		expect(
			parseTrainProgress("E123\n08:30 - Connolly to Howth (DART)"),
		).toBeNull();
	});
});

describe("markerColor", () => {
	function train(status: Train["status"], message: string): Train {
		return {
			code: "X",
			lat: 0,
			lng: 0,
			status,
			message,
			direction: "",
			date: "",
		};
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

	describe("train (in service 05:00 – 01:00 next day)", () => {
		test("midday is in service", () => {
			expect(isInServiceHours("train", dublinWinter(12, 0))).toBe(true);
		});
		test("23:59 is in service", () => {
			expect(isInServiceHours("train", dublinWinter(23, 59))).toBe(true);
		});
		test("00:00 remains in service", () => {
			expect(isInServiceHours("train", dublinWinter(0, 0))).toBe(true);
		});
		test("00:59 remains in service", () => {
			expect(isInServiceHours("train", dublinWinter(0, 59))).toBe(true);
		});
		test("01:00 closes the window", () => {
			expect(isInServiceHours("train", dublinWinter(1, 0))).toBe(false);
		});
		test("04:59 is still off-hours", () => {
			expect(isInServiceHours("train", dublinWinter(4, 59))).toBe(false);
		});
		test("05:00 reopens the window", () => {
			expect(isInServiceHours("train", dublinWinter(5, 0))).toBe(true);
		});
	});

	describe("bus (24-hour service)", () => {
		test("04:59 is in service", () => {
			expect(isInServiceHours("bus", dublinWinter(4, 59))).toBe(true);
		});
		test("05:00 opens the window", () => {
			expect(isInServiceHours("bus", dublinWinter(5, 0))).toBe(true);
		});
		test("23:59 is in service", () => {
			expect(isInServiceHours("bus", dublinWinter(23, 59))).toBe(true);
		});
		test("00:00 remains in service", () => {
			expect(isInServiceHours("bus", dublinWinter(0, 0))).toBe(true);
		});
		test("00:59 remains in service", () => {
			expect(isInServiceHours("bus", dublinWinter(0, 59))).toBe(true);
		});
		test("01:00 remains in service", () => {
			expect(isInServiceHours("bus", dublinWinter(1, 0))).toBe(true);
		});
	});

	describe("DST: Dublin local time decides, not UTC", () => {
		// The whole reason isInServiceHours formats through Europe/Dublin instead
		// of reading getHours() — without that, summer answers would be off by 1h.
		test("Dublin 05:00 is in service for train and bus in Jan and Jul", () => {
			expect(isInServiceHours("train", dublinWinter(5, 0))).toBe(true);
			expect(isInServiceHours("train", dublinSummer(5, 0))).toBe(true);
			expect(isInServiceHours("bus", dublinWinter(5, 0))).toBe(true);
			expect(isInServiceHours("bus", dublinSummer(5, 0))).toBe(true);
		});
		test("Dublin 04:59 is off-hours for train but in service for bus in Jan and Jul", () => {
			expect(isInServiceHours("train", dublinWinter(4, 59))).toBe(false);
			expect(isInServiceHours("train", dublinSummer(4, 59))).toBe(false);
			expect(isInServiceHours("bus", dublinWinter(4, 59))).toBe(true);
			expect(isInServiceHours("bus", dublinSummer(4, 59))).toBe(true);
		});
		test("Dublin 00:59 is in service for train and bus in Jan and Jul", () => {
			expect(isInServiceHours("train", dublinWinter(0, 59))).toBe(true);
			expect(isInServiceHours("train", dublinSummer(0, 59))).toBe(true);
			expect(isInServiceHours("bus", dublinWinter(0, 59))).toBe(true);
			expect(isInServiceHours("bus", dublinSummer(0, 59))).toBe(true);
		});
		test("Dublin 01:00 is off-hours for train but in service for bus in Jan and Jul", () => {
			expect(isInServiceHours("train", dublinWinter(1, 0))).toBe(false);
			expect(isInServiceHours("train", dublinSummer(1, 0))).toBe(false);
			expect(isInServiceHours("bus", dublinWinter(1, 0))).toBe(true);
			expect(isInServiceHours("bus", dublinSummer(1, 0))).toBe(true);
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
		expect(escapeHtml(payload)).toBe(
			`&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;`,
		);
	});

	test("empty string and plain ascii pass through unchanged", () => {
		expect(escapeHtml("")).toBe("");
		expect(escapeHtml("Connolly Station")).toBe("Connolly Station");
	});
});
