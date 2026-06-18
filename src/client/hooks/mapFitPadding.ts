type FitPaddingPurpose = "focusSegment" | "routeOverview";

const MOBILE_FIT_VIEWPORT_MAX_WIDTH = 600;
const SHORT_SEGMENT_METERS = 3_000;
const LONG_SEGMENT_METERS = 9_000;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, amount: number): number {
	return from + (to - from) * amount;
}

function getLongSegmentAmount(bounds: L.LatLngBounds): number {
	const diagonalMeters = bounds
		.getSouthWest()
		.distanceTo(bounds.getNorthEast());

	return clamp(
		(diagonalMeters - SHORT_SEGMENT_METERS) /
			(LONG_SEGMENT_METERS - SHORT_SEGMENT_METERS),
		0,
		1,
	);
}

export function getMapFitPadding(
	map: L.Map,
	bounds: L.LatLngBounds,
	purpose: FitPaddingPurpose,
): {
	paddingTopLeft: L.PointExpression;
	paddingBottomRight: L.PointExpression;
} {
	const size = map.getSize();
	const isMobile = size.x <= MOBILE_FIT_VIEWPORT_MAX_WIDTH;

	if (!isMobile) {
		return purpose === "focusSegment"
			? {
					paddingTopLeft: [20, 60],
					paddingBottomRight: [20, 80],
				}
			: {
					paddingTopLeft: [20, 40],
					paddingBottomRight: [20, 60],
				};
	}

	const longSegmentAmount = getLongSegmentAmount(bounds);

	if (purpose === "routeOverview") {
		return {
			paddingTopLeft: [
				20,
				Math.round(
					clamp(lerp(size.y * 0.09, size.y * 0.06, longSegmentAmount), 44, 72),
				),
			],
			paddingBottomRight: [
				Math.round(
					clamp(lerp(size.x * 0.17, size.x * 0.11, longSegmentAmount), 44, 76),
				),
				Math.round(
					clamp(lerp(size.y * 0.2, size.y * 0.13, longSegmentAmount), 105, 155),
				),
			],
		};
	}

	return {
		paddingTopLeft: [
			24,
			Math.round(
				clamp(lerp(size.y * 0.11, size.y * 0.07, longSegmentAmount), 52, 88),
			),
		],
		paddingBottomRight: [
			Math.round(
				clamp(lerp(size.x * 0.22, size.x * 0.16, longSegmentAmount), 64, 100),
			),
			Math.round(
				clamp(lerp(size.y * 0.27, size.y * 0.17, longSegmentAmount), 130, 205),
			),
		],
	};
}
