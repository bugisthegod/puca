import { getGtfsrHealthSnapshot, type Operator } from "../gtfsr.ts";
import { OPERATORS } from "../types.ts";

export const VALID_OPERATORS = new Set<Operator>(OPERATORS);

export function parseOperator(raw: string | null): Operator | null {
	if (!raw) return null;
	return VALID_OPERATORS.has(raw as Operator) ? (raw as Operator) : null;
}

// Clamp ?mins= for Irish Rail station endpoint: NaN/huge values would still
// hit the upstream API and pollute cache keys.
export function clampMins(raw: string | null, fallback: number): number {
	if (!raw) return fallback;
	const n = parseInt(raw, 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(120, Math.max(1, n));
}

// Irish Rail TrainDate format: "6 may 2026" / "06 may 2026" (lowercase short month).
// Day 1-31, month must be a real short name, year within ±1 of today — keeps
// cache keys bounded so an attacker can't blow up the cache by varying ?date=.
// Frontend doesn't send ?date= at all (server defaults to today), so failing
// validation simply falls back to today is fine.
const TRAIN_DATE_RE =
	/^(0?[1-9]|[12]\d|3[01]) (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \d{4}$/;

export function isValidTrainDate(raw: string): boolean {
	if (!TRAIN_DATE_RE.test(raw)) return false;
	const year = parseInt(raw.slice(-4), 10);
	const thisYear = new Date().getFullYear();
	return year >= thisYear - 1 && year <= thisYear + 1;
}

// Irish Rail's "today" is Dublin's today — not fly's UTC today, which can be
// yesterday during summer-evening / early-morning windows.
const DUBLIN_DATE_FMT = new Intl.DateTimeFormat("en-IE", {
	timeZone: "Europe/Dublin",
	day: "numeric",
	month: "short",
	year: "numeric",
});

export function todayFormatted(): string {
	const parts = DUBLIN_DATE_FMT.formatToParts(new Date());
	const day = parts.find((p) => p.type === "day")?.value;
	const month = parts.find((p) => p.type === "month")?.value.toLowerCase();
	const year = parts.find((p) => p.type === "year")?.value;
	return `${day} ${month} ${year}`;
}

export function staticFile(path: string, ttlSec: number) {
	return () =>
		new Response(Bun.file(path), {
			headers: { "Cache-Control": `public, max-age=${ttlSec}` },
		});
}

export function memoryMb(): number {
	return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

export function hasUsableTrainPosition(
	train: { lat: number; lng: number } | undefined,
): boolean {
	return !!train && !(train.lat === 0 && train.lng === 0);
}

export async function detailedHealth() {
	return {
		ok: true,
		uptimeSec: Math.round(process.uptime()),
		memoryMb: memoryMb(),
		gtfsr: await getGtfsrHealthSnapshot(),
	};
}
