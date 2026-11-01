import { beforeAll, describe, expect, test } from "bun:test";
import {
	buildTrainPopupErrorHTML,
	buildTrainPopupHTML,
	buildTrainPopupWithMovements,
	buildTrainStatusText,
	formatTrainPopupMessage,
	trainPopupStatusClass,
} from "../src/client/hooks/trainPopup";
import { setLocale } from "../src/client/i18n";
import type { Train, TrainMovement } from "../src/types";

beforeAll(() => {
	setLocale("en");
});

function train(overrides: Partial<Train> = {}): Train {
	return {
		code: "E123",
		lat: 53.35,
		lng: -6.26,
		status: "R",
		message:
			"E123\n08:30 - Origin & A to Destination <B> (DART) - 10 mins late",
		direction: "Northbound",
		date: "8 May 2026",
		...overrides,
	};
}

function movement(overrides: Partial<TrainMovement> = {}): TrainMovement {
	return {
		trainCode: "E123",
		stationName: "Connolly & Dock",
		stationCode: "CNLLY",
		scheduledArrival: "08:00:00",
		scheduledDepart: "08:01:00",
		expectedArrival: "08:05:00",
		expectedDepart: "08:06:00",
		arrival: "",
		departure: "",
		stopType: "S",
		locationType: "S",
		...overrides,
	};
}

describe("train popup formatting", () => {
	test("maps train status and lateness to labels/classes", () => {
		expect(buildTrainStatusText("N", null)).toBe("Not yet running");
		expect(buildTrainStatusText("T", 5)).toBe("Terminated");
		expect(buildTrainStatusText("R", null)).toBe("Running");
		expect(buildTrainStatusText("R", 0)).toBe("On time");
		expect(buildTrainStatusText("R", -1)).toBe("On time (1 min early)");
		expect(buildTrainStatusText("R", 10)).toBe("10 mins late");

		expect(trainPopupStatusClass("N", 10)).toBe("");
		expect(trainPopupStatusClass("R", 5)).toBe("popup-status--yellow");
		expect(trainPopupStatusClass("R", 10)).toBe("popup-status--red");
	});

	test("escapes messages before normalizing literal and real newlines", () => {
		expect(formatTrainPopupMessage("A < B\\nC & D\nE")).toBe(
			"A &lt; B<br>C &amp; D<br>E",
		);
	});
});

describe("buildTrainPopupHTML", () => {
	test("renders loading state with escaped title, route, direction, and late status", () => {
		const html = buildTrainPopupHTML(
			train({ code: "E<123>", direction: "North & South" }),
		);

		expect(html).toContain("E&lt;123&gt;");
		expect(html).toContain("Origin &amp; A → Destination &lt;B&gt;");
		expect(html).toContain("North &amp; South");
		expect(html).toContain("10 mins late");
		expect(html).toContain("popup-status--red");
		expect(html).toContain("Loading stops");
	});

	test("renders error state by replacing the loading text", () => {
		const html = buildTrainPopupErrorHTML(train());

		expect(html).toContain("Could not load movement data.");
		expect(html).not.toContain("Loading stops");
	});

	test("renders movement table with current row and expected-time fallback", () => {
		const html = buildTrainPopupWithMovements(train(), [
			movement({ stopType: "O", stationName: "Origin" }),
			movement({
				stopType: "C",
				stationName: "Current <Station>",
				expectedArrival: "08:10:00",
				expectedDepart: "08:11:00",
			}),
		]);

		expect(html).toContain("movements-table");
		expect(html).toContain("Origin");
		expect(html).toContain("Current &lt;Station&gt;");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("movement-current");
		expect(html).toContain("Current</td>");
		expect(html).toContain("08:10");
		expect(html).toContain("08:11");
	});

	test("replaces cardinal direction chips with the destination", () => {
		const html = buildTrainPopupWithMovements(
			train({ direction: "Southbound" }),
			[
				movement({ stationName: "Maynooth", stopType: "O" }),
				movement({ stationName: "Grand Canal Dock", stopType: "D" }),
			],
		);

		expect(html).toContain("Grand Canal Dock");
		expect(html).not.toContain("Southbound");
	});

	test("uses PublicMessage progress when movement stop types are stale", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"E848\n22:42 - Bray to Malahide (1 mins late)\nDeparted Kilbarrack next stop Howth Junction",
			}),
			[
				movement({
					stationName: "Bray",
					stopType: "C",
					expectedDepart: "22:42:00",
				}),
				movement({
					stationName: "Woodbrook",
					stopType: "N",
					expectedDepart: "22:45:00",
				}),
				movement({
					stationName: "Kilbarrack",
					stopType: "S",
					expectedDepart: "23:38:00",
				}),
				movement({
					stationName: "Howth Junction",
					stopType: "S",
					expectedDepart: "23:41:00",
				}),
			],
		);

		expect(html).toContain("Kilbarrack");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("<td>Current</td>");
		expect(html).toContain("Howth Junction");
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain(
			'Bray</span> <span class="movement-current-marker"',
		);
	});

	test("marks movement rows between PublicMessage current and next as pass-through", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"A612\n16:35 - Dublin Connolly to Rosslare Europort (2 mins late)\nDeparted Sydney Parade next stop Dun Laoghaire",
			}),
			[
				movement({ stationName: "Sydney Parade", stopType: "S" }),
				movement({
					stationName: "Booterstown",
					stopType: "S",
					locationType: "",
				}),
				movement({ stationName: "Blackrock", stopType: "S", locationType: "" }),
				movement({ stationName: "Dun Laoghaire", stopType: "S" }),
			],
		);

		expect(html).toContain("Sydney Parade");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("Dun Laoghaire");
		expect(html).toContain("<td>Next</td>");
		expect(html.match(/movement-pass-through/g)?.length).toBe(2);
		expect(html.match(/<td>Passes<\/td>/g)?.length).toBe(2);
	});

	test("marks scheduled timing points as pass-through before they are current", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"A612\n16:35 - Dublin Connolly to Rosslare Europort (2 mins late)\nDeparted Tara Street",
			}),
			[
				movement({ stationName: "Tara Street", locationType: "S" }),
				movement({ stationName: "Grand Canal Dock", locationType: "T" }),
				movement({ stationName: "Lansdowne Road", locationType: "T" }),
				movement({ stationName: "Dun Laoghaire", locationType: "S" }),
			],
		);

		expect(html).toContain("Grand Canal Dock");
		expect(html).toContain("Lansdowne Road");
		expect(html.match(/movement-pass-through/g)?.length).toBe(2);
		expect(html.match(/<td>Passes<\/td>/g)?.length).toBe(2);
	});

	test("does not infer pass-through over explicit stopping location types", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"A612\n16:35 - Dublin Connolly to Rosslare Europort (2 mins late)\nDeparted Tara Street next stop Dun Laoghaire",
			}),
			[
				movement({ stationName: "Tara Street", locationType: "S" }),
				movement({ stationName: "Grand Canal Dock", locationType: "S" }),
				movement({ stationName: "Lansdowne Road", locationType: "S" }),
				movement({ stationName: "Dun Laoghaire", locationType: "S" }),
			],
		);

		expect(html).not.toContain("movement-pass-through");
		expect(html).not.toContain("<td>Passes</td>");
	});

	test("keeps PublicMessage next label if a feed row is also a timing point", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"A612\n16:35 - Dublin Connolly to Rosslare Europort (2 mins late)\nDeparted Tara Street next stop Grand Canal Dock",
			}),
			[
				movement({ stationName: "Tara Street", locationType: "S" }),
				movement({ stationName: "Grand Canal Dock", locationType: "T" }),
			],
		);

		expect(html).toContain("Grand Canal Dock");
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain("<td>Passes</td>");
	});

	test("hides duplicate named timing points next to their stopping row", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"E213\n11:03 - Malahide to Bray (DART)\nDeparted Tara Street next stop Dublin Pearse",
			}),
			[
				movement({ stationName: "Tara Street", stationCode: "TARA" }),
				movement({
					stationName: "Dublin Pearse",
					stationCode: "PERSE",
					locationType: "S",
					expectedArrival: "11:34:48",
					expectedDepart: "11:35:30",
				}),
				movement({
					stationName: "Dublin Pearse",
					stationCode: "PERSE",
					locationType: "T",
					expectedArrival: "11:36:30",
					expectedDepart: "11:36:30",
				}),
				movement({ stationName: "Grand Canal Dock", stationCode: "GCDK" }),
			],
		);

		expect(html.match(/Dublin Pearse/g)?.length).toBe(1);
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain("<td>Passes</td>");
	});

	test("hides unnamed timing points instead of showing blank pass-through rows", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"E212\n10:25 - Malahide to Bray (DART)\nDeparted Clontarf Road next stop Dublin Connolly",
			}),
			[
				movement({ stationName: "Clontarf Road", stationCode: "CTARF" }),
				movement({
					stationName: "",
					stationCode: "EWALL",
					locationType: "T",
					expectedArrival: "10:55:00",
					expectedDepart: "10:55:00",
				}),
				movement({
					stationName: "",
					stationCode: "SUBJN",
					locationType: "T",
					expectedArrival: "10:56:00",
					expectedDepart: "10:56:00",
				}),
				movement({
					stationName: "Dublin Connolly",
					stationCode: "CNLLY",
				}),
			],
		);

		expect(html).toContain("Clontarf Road");
		expect(html).toContain("Dublin Connolly");
		expect(html).not.toContain("<td>Passes</td>");
		expect(html).not.toContain("10:55");
		expect(html).not.toContain("10:56");
	});

	test("labels a current timing point as passing instead of a stopping current station", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"A612\n16:35 - Dublin Connolly to Rosslare Europort (2 mins late)\nDeparted Sydney Parade next stop Dun Laoghaire",
			}),
			[
				movement({ stationName: "Sydney Parade", locationType: "T" }),
				movement({ stationName: "Booterstown", locationType: "T" }),
				movement({ stationName: "Dun Laoghaire", locationType: "S" }),
			],
		);

		expect(html).toContain("Sydney Parade");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("movement-current movement-pass-through");
		expect(html).toContain("<td>Passing</td>");
	});

	test("clears movement-provided next when it is before the PublicMessage current station", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"E848\n22:42 - Bray to Malahide (1 mins late)\nDeparted Kilbarrack next stop Howth Jct",
			}),
			[
				movement({ stationName: "Bray", stopType: "C" }),
				movement({ stationName: "Woodbrook", stopType: "N" }),
				movement({ stationName: "Kilbarrack", stopType: "S" }),
				movement({ stationName: "Howth Junction", stopType: "S" }),
			],
		);

		expect(html).toContain("Kilbarrack");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("Woodbrook");
		expect(html).not.toContain("<td>Next</td>");
		expect(html).not.toContain(
			'Bray</span> <span class="movement-current-marker"',
		);
	});

	test("keeps movement-provided next after PublicMessage current when next stop cannot be matched", () => {
		const html = buildTrainPopupWithMovements(
			train({
				message:
					"E848\n22:42 - Bray to Malahide (1 mins late)\nDeparted Kilbarrack next stop Howth Jct",
			}),
			[
				movement({ stationName: "Bray", stopType: "C" }),
				movement({ stationName: "Kilbarrack", stopType: "S" }),
				movement({ stationName: "Howth Junction", stopType: "N" }),
			],
		);

		expect(html).toContain("Kilbarrack");
		expect(html).toContain("movement-current-marker");
		expect(html).toContain("Howth Junction");
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain(
			'Bray</span> <span class="movement-current-marker"',
		);
	});

	test("falls back to formatted train message when movements are empty", () => {
		const html = buildTrainPopupWithMovements(
			train({ message: "No route <yet>\\nCheck later" }),
			[],
		);

		expect(html).toContain("popup-message");
		expect(html).toContain("No route &lt;yet&gt;<br>Check later");
		expect(html).not.toContain("movements-table");
	});
});
