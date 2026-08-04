import type { BusOperator } from "../../types";

const OPERATORS: readonly BusOperator[] = [
	"dublinbus",
	"buseireann",
	"goahead",
];

// Below this zoom the stop layer is only four-digit cluster bubbles — nothing
// a user standing at a stop can act on. Hiding it outright also caps the burst
// crossing the layer: markercluster chunks addLayers but removeLayers is a
// plain synchronous loop, so a zoom-out/zoom-in pair over the full 11k stops
// would block the main thread in both directions.
export const BUS_STOP_MIN_ZOOM = 14;

export function shouldRenderBusStopLayer(zoom: number): boolean {
	return zoom >= BUS_STOP_MIN_ZOOM;
}

export function busStopClusterRadius(zoom: number): number {
	if (zoom >= 18) return 0;
	return zoom < 9 ? 64 : zoom < 14 ? 50 : 34;
}

export function dominantBusOperatorFromClassNames(
	classNames: readonly string[],
	markerClassPrefix: string,
): BusOperator {
	const counts: Record<BusOperator, number> = {
		dublinbus: 0,
		buseireann: 0,
		goahead: 0,
	};

	for (const className of classNames) {
		const operator = OPERATORS.find((candidate) =>
			className.includes(`${markerClassPrefix}${candidate}`),
		);
		counts[operator ?? "dublinbus"]++;
	}

	const ranked = [...OPERATORS].sort((a, b) => counts[b] - counts[a]);
	const [top, runnerUp] = ranked;
	if (!top || !runnerUp || counts[top] === counts[runnerUp]) {
		return "dublinbus";
	}
	return top;
}
