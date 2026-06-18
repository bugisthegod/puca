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
		expect(html).toContain("Current &lt;Station&gt; ▶");
		expect(html).toContain("movement-current");
		expect(html).toContain("Origin</td>");
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

		expect(html).toContain("Kilbarrack ▶");
		expect(html).toContain("<td>Current</td>");
		expect(html).toContain("Howth Junction");
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain("Bray ▶");
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

		expect(html).toContain("Kilbarrack ▶");
		expect(html).toContain("Woodbrook");
		expect(html).not.toContain("<td>Next</td>");
		expect(html).not.toContain("Bray ▶");
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

		expect(html).toContain("Kilbarrack ▶");
		expect(html).toContain("Howth Junction");
		expect(html).toContain("<td>Next</td>");
		expect(html).not.toContain("Bray ▶");
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
