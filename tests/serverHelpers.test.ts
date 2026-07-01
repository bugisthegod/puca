import { describe, expect, test } from "bun:test";
import {
	clampMins,
	hasUsableTrainPosition,
	isValidTrainDate,
	parseOperator,
	todayFormatted,
} from "../src/server/helpers";

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
	const year = new Date().getFullYear();

	test("accepts Irish Rail formatted dates", () => {
		expect(isValidTrainDate(`6 may ${year}`)).toBe(true);
		expect(isValidTrainDate(`06 may ${year}`)).toBe(true);
		expect(isValidTrainDate(`31 dec ${year - 1}`)).toBe(true);
		expect(isValidTrainDate(`1 jan ${year + 1}`)).toBe(true);
	});

	test("rejects malformed dates", () => {
		expect(isValidTrainDate("")).toBe(false);
		expect(isValidTrainDate(`32 may ${year}`)).toBe(false);
		expect(isValidTrainDate(`0 may ${year}`)).toBe(false);
		expect(isValidTrainDate(`6 xyz ${year}`)).toBe(false);
		expect(isValidTrainDate(`6 May ${year}`)).toBe(false);
		expect(isValidTrainDate(`6 may ${year} extra`)).toBe(false);
	});

	test("bounds the year to ±1 so cache keys stay bounded", () => {
		expect(isValidTrainDate(`6 may ${year - 2}`)).toBe(false);
		expect(isValidTrainDate(`6 may ${year + 2}`)).toBe(false);
	});

	test("todayFormatted output is itself a valid train date", () => {
		expect(isValidTrainDate(todayFormatted())).toBe(true);
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
