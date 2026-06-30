import type { Feature, LineString } from "geojson";
import { buildRouteLine, buildRouteLookup } from "./routeProjection";

export type TrainShapeLineInfo = {
	routeLine: Feature<LineString>;
	routeLookup: Float64Array | null;
	routeLengthMeters: number;
};

type TrainShapeCacheEntry = TrainShapeLineInfo | "not-found";

const TRAIN_SHAPE_CACHE_MAX = 200;
const trainShapeCache = new Map<string, TrainShapeCacheEntry>();

// Single-flight bulk loader: one /api/train/shapes request shared across the
// whole app. Avoids the previous N-parallel-request fan-out that triggered CF
// rate limits when many trains were active.
//
// Failure handling: on 5xx / network error / non-OK, the cached promise is
// cleared so the next caller can retry. The promise itself rejects, letting
// fetchCachedTrainShape() distinguish "bulk failed" (don't poison cache) from
// "bulk succeeded but pair missing" (cache as not-found).
type AllShapesData = {
	endpoints: Record<string, string>; // pair key -> routeKey
	shapes: Record<string, { coords?: [number, number][] }>; // routeKey -> shape
};

let allTrainShapesPromise: Promise<AllShapesData> | null = null;
let normalizedShapeEndpoints: Record<string, string> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAllTrainShapesData(value: unknown): AllShapesData {
	if (
		!isRecord(value) ||
		!isRecord(value.endpoints) ||
		!isRecord(value.shapes)
	) {
		throw new Error("Invalid train shapes payload");
	}
	return value as AllShapesData;
}

function loadAllTrainShapes(): Promise<AllShapesData> {
	if (allTrainShapesPromise) return allTrainShapesPromise;
	const p = fetch("/api/train/shapes").then((res) => {
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json().then(parseAllTrainShapesData);
	});
	allTrainShapesPromise = p;
	// Detached: clear ref on failure so next call retries; don't swallow rejection here
	p.catch(() => {
		if (allTrainShapesPromise === p) allTrainShapesPromise = null;
	});
	return p;
}

function normalizeEndpointName(name: string): string {
	return name
		.toLowerCase()
		.replace(/\([^)]*\)/g, "")
		.replace(/\b(casement|ceannt|colbert|kent|plunkett)\b/g, "")
		.replace(/\bstation\b/g, "")
		.replace(/[^a-z0-9]+/g, "");
}

function endpointKey(origin: string, destination: string): string {
	return `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
}

export function normalizedEndpointKey(
	origin: string,
	destination: string,
): string {
	return `${normalizeEndpointName(origin)}|${normalizeEndpointName(destination)}`;
}

function getShapeRouteKey(
	allShapes: AllShapesData,
	origin: string,
	destination: string,
): string | undefined {
	const exact = allShapes.endpoints[endpointKey(origin, destination)];
	if (exact) return exact;

	if (!normalizedShapeEndpoints) {
		const next: Record<string, string> = {};
		for (const [pairKey, routeKey] of Object.entries(allShapes.endpoints)) {
			const [from, to] = pairKey.split("|");
			if (!from || !to) continue;
			const normalized = normalizedEndpointKey(from, to);
			if (!next[normalized]) next[normalized] = routeKey;
		}
		normalizedShapeEndpoints = next;
	}

	return normalizedShapeEndpoints[normalizedEndpointKey(origin, destination)];
}

// Insertion-order LRU cap: drop oldest entries once the cache exceeds the limit.
function setShapeCache(key: string, value: TrainShapeCacheEntry): void {
	trainShapeCache.delete(key); // ensure re-insertion moves key to the end of insertion order
	trainShapeCache.set(key, value);
	while (trainShapeCache.size > TRAIN_SHAPE_CACHE_MAX) {
		const oldest = trainShapeCache.keys().next().value;
		if (oldest === undefined) break;
		trainShapeCache.delete(oldest);
	}
}

export function getCachedTrainShapeByKey(
	key: string,
): TrainShapeLineInfo | null | undefined {
	const cached = trainShapeCache.get(key);
	return cached === "not-found" ? null : cached;
}

// Looks up a train shape from the bulk in-memory map (loaded once on first call).
// Caches the derived routeLine/routeLookup per (origin, destination) pair.
// On bulk-load failure, returns null without caching — next call retries.
export async function fetchCachedTrainShape(
	origin: string,
	destination: string,
	key = normalizedEndpointKey(origin, destination),
): Promise<TrainShapeLineInfo | null> {
	const cached = trainShapeCache.get(key);
	if (cached !== undefined) {
		return cached === "not-found" ? null : cached;
	}

	let allShapes: AllShapesData;
	try {
		allShapes = await loadAllTrainShapes();
	} catch {
		// Transient: don't poison cache so next tick can retry once promise is reset
		return null;
	}

	const routeKey = getShapeRouteKey(allShapes, origin, destination);
	const data = routeKey ? allShapes.shapes[routeKey] : undefined;
	if (data?.coords && data.coords.length >= 2) {
		const built = buildRouteLine(data.coords);
		if (built) {
			const entry = {
				...built,
				routeLookup: buildRouteLookup(built.routeLine),
			};
			setShapeCache(key, entry);
			return entry;
		}
	}

	setShapeCache(key, "not-found");
	return null;
}
