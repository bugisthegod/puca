import trainEndpoints from "../data/train-routes-by-endpoints.json" with {
	type: "json",
};
import trainShapes from "../data/train-shapes.json" with { type: "json" };

export type TrainRouteShape = {
	headsign: string;
	coords: [number, number][];
	stops: { id: string; name: string; lat: number; lng: number }[];
};

type TrainEndpointMap = Record<
	string,
	{ routeId: string; directionId: number }
>;
type TrainShapeMap = Record<string, Record<string, TrainRouteShape>>;

const endpoints = trainEndpoints as unknown as TrainEndpointMap;
const shapes = trainShapes as unknown as TrainShapeMap;

export function getTrainRouteShape(
	origin: string,
	destination: string,
): TrainRouteShape | null {
	const key = `${origin.trim().toLowerCase()}|${destination.trim().toLowerCase()}`;
	const match = endpoints[key];
	if (!match) return null;

	const shape = shapes[match.routeId]?.[String(match.directionId)];
	if (!shape) return null;

	return { headsign: shape.headsign, coords: shape.coords, stops: shape.stops };
}

// Two-level shape map for the bulk client endpoint:
//   endpoints: 156 endpoint pair keys -> routeKey (deduped reference)
//   shapes:    36 unique shapes by routeKey, only `coords` (the only field the client uses)
// Avoids the 4x duplication that would happen if every endpoint pair carried its own coords.
// Pre-computed at module load - zero cost per request.
const allTrainShapesPayload: {
	endpoints: Record<string, string>;
	shapes: Record<string, { coords: [number, number][] }>;
} = (() => {
	const endpointsOut: Record<string, string> = {};
	const shapesOut: Record<string, { coords: [number, number][] }> = {};
	for (const [pairKey, { routeId, directionId }] of Object.entries(endpoints)) {
		const shape = shapes[routeId]?.[String(directionId)];
		if (!shape) continue;
		const routeKey = `${routeId}|${directionId}`;
		endpointsOut[pairKey] = routeKey;
		if (!shapesOut[routeKey]) {
			shapesOut[routeKey] = { coords: shape.coords };
		}
	}
	return { endpoints: endpointsOut, shapes: shapesOut };
})();

export function getAllTrainShapes(): typeof allTrainShapesPayload {
	return allTrainShapesPayload;
}
