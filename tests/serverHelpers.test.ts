import { describe, expect, test } from "bun:test";
import {
	clampMins,
	filterTrainMapPositions,
	hasUsableTrainPosition,
	isValidTrainDate,
	parseOperator,
	todayFormatted,
} from "../src/server/helpers";
import type { Train } from "../src/types";

describe("parseOperator", () => {
	test("accepts known operators", () => {
		expect(parseOperator("dublinbus")).toBe("dublinbus");
		expect(parseOperator("buseireann")).toBe("buseireann");
		expect(parseOperator("goahead")).toBe("goahead");
	});

	test("rejects null, empty, and unknown values", () => {
		expect(parseOperator(null)).toBeNull();
		expect(parseOperator("")).toBeNull();
		expect(parseOperator("luas")).toBeNull();
		expect(parseOperator("DUBLINBUS")).toBeNull();
		expect(parseOperator("dublinbus ")).toBeNull();
	});
});

describe("clampMins", () => {
	test("falls back on missing or non-numeric input", () => {
		expect(clampMins(null, 90)).toBe(90);
		expect(clampMins("", 90)).toBe(90);
		expect(clampMins("abc", 90)).toBe(90);
	});

	test("clamps out-of-range values into 1-120", () => {
		expect(clampMins("0", 90)).toBe(1);
		expect(clampMins("-5", 90)).toBe(1);
		expect(clampMins("121", 90)).toBe(120);
		expect(clampMins("99999999", 90)).toBe(120);
	});

	test("passes through in-range values", () => {
		expect(clampMins("1", 90)).toBe(1);
		expect(clampMins("45", 90)).toBe(45);
		expect(clampMins("120", 90)).toBe(120);
	});
});

describe("isValidTrainDate", () => {
	const referenceNow = new Date("2026-06-01T12:00:00Z");
	const year = referenceNow.getUTCFullYear();

	test("accepts Irish Rail formatted dates", () => {
		expect(isValidTrainDate(`6 may ${year}`, referenceNow)).toBe(true);
		expect(isValidTrainDate(`06 may ${year}`, referenceNow)).toBe(true);
		expect(isValidTrainDate(`31 dec ${year - 1}`, referenceNow)).toBe(true);
		expect(isValidTrainDate(`1 jan ${year + 1}`, referenceNow)).toBe(true);
	});

	test("rejects malformed dates", () => {
		expect(isValidTrainDate("", referenceNow)).toBe(false);
		expect(isValidTrainDate(`32 may ${year}`, referenceNow)).toBe(false);
		expect(isValidTrainDate(`0 may ${year}`, referenceNow)).toBe(false);
		expect(isValidTrainDate(`6 xyz ${year}`, referenceNow)).toBe(false);
		expect(isValidTrainDate(`6 May ${year}`, referenceNow)).toBe(false);
		expect(isValidTrainDate(`6 may ${year} extra`, referenceNow)).toBe(false);
	});

	test("bounds the year to ±1 so cache keys stay bounded", () => {
		expect(isValidTrainDate(`6 may ${year - 2}`, referenceNow)).toBe(false);
		expect(isValidTrainDate(`6 may ${year + 2}`, referenceNow)).toBe(false);
	});

	test("todayFormatted uses Irish Rail's fixed September abbreviation", () => {
		const september = new Date("2026-09-01T12:00:00Z");
		expect(todayFormatted(september)).toBe("1 sep 2026");
		expect(isValidTrainDate(todayFormatted(september), september)).toBe(true);
	});
});

describe("filterTrainMapPositions", () => {
	const clondalkin = (code: string, departure: string): Train => ({
		code,
		date: "07 Nov 2026",
		status: "R",
		lat: 53.3334,
		lng: -6.40628,
		direction: "To Dublin Heuston",
		message: `${code}\\n${departure} - Cork to Dublin Heuston (11 mins late)\\nDeparted Clondalkin next stop Dublin Heuston`,
	});

	test("hides the observed future services while retaining a morning train", () => {
		const morning = clondalkin("A209", "09:25");
		const trains = [
			morning,
			clondalkin("A223", "16:25"),
			clondalkin("A225", "17:25"),
			clondalkin("A227", "18:25"),
			clondalkin("A231", "20:25"),
		];
		expect(
			filterTrainMapPositions(trains, new Date("2026-11-07T10:43:00Z")),
		).toEqual([morning]);
	});

	test("allows 15 minutes of early running on the Dublin clock", () => {
		const withinTolerance = {
			...clondalkin("A223", "16:25"),
			date: "07 Jul 2026",
		};
		const tooEarly = { ...clondalkin("A225", "16:26"), date: "7 jul 2026" };
		expect(
			filterTrainMapPositions(
				[withinTolerance, tooEarly],
				new Date("2026-07-07T15:10:00Z"),
			),
		).toEqual([withinTolerance]);
	});

	test("retains overnight runs, predeparture trains and ambiguous reports", () => {
		const train = clondalkin("A223", "23:55");
		const trains: Train[] = [
			{ ...train, date: "06 Nov 2026" },
			{ ...train, status: "N", message: "Expected Departure 23:55" },
			{
				...train,
				message: train.message.replace("Departed Clondalkin", "Arrived Cork"),
			},
			{ ...train, message: train.message.replace("23:55", "25:55") },
		];
		expect(
			filterTrainMapPositions(trains, new Date("2026-11-07T00:10:00Z")),
		).toEqual(trains);
	});
});

describe("hasUsableTrainPosition", () => {
	test("rejects missing trains and the 0,0 placeholder", () => {
		expect(hasUsableTrainPosition(undefined)).toBe(false);
		expect(hasUsableTrainPosition({ lat: 0, lng: 0 })).toBe(false);
	});

	test("accepts real coordinates, including a single zero axis", () => {
		expect(hasUsableTrainPosition({ lat: 53.35, lng: -6.26 })).toBe(true);
		expect(hasUsableTrainPosition({ lat: 0, lng: -6.26 })).toBe(true);
	});
});
