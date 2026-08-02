import type { BusOperator } from "../../types";

const OPERATORS: readonly BusOperator[] = [
	"dublinbus",
	"buseireann",
	"goahead",
];

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
