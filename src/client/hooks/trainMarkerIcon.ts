export type TrainIconSpec = {
	className: string;
	html: string;
	iconSize: [number, number];
	iconAnchor: [number, number];
};

export type TrainMarkerOffset = {
	x: number;
	y: number;
};

const ZERO_OFFSET: TrainMarkerOffset = { x: 0, y: 0 };

function anchorWithOffset(
	centerX: number,
	centerY: number,
	offset: TrainMarkerOffset,
): [number, number] {
	return [centerX - offset.x, centerY - offset.y];
}

export function buildTrainIconSpec(
	color: string,
	offset: TrainMarkerOffset = ZERO_OFFSET,
): TrainIconSpec {
	return {
		className: "train-marker",
		html: `<div class="train-icon train-icon--halloween" style="color:${color}"><img src="/train-marker.png?v=green-halloween-2" width="30" height="36" alt="" aria-hidden="true" draggable="false" /></div>`,
		iconSize: [22, 22],
		iconAnchor: anchorWithOffset(11, 11, offset),
	};
}

export function buildTrainHitIconSpec(
	offset: TrainMarkerOffset = ZERO_OFFSET,
): TrainIconSpec {
	return {
		className: "train-hit-marker",
		html: `<div class="train-hit-target" aria-hidden="true"></div>`,
		iconSize: [40, 40],
		iconAnchor: anchorWithOffset(20, 20, offset),
	};
}

export function makeTrainIcon(
	color: string,
	offset: TrainMarkerOffset = ZERO_OFFSET,
): L.DivIcon {
	return L.divIcon(buildTrainIconSpec(color, offset));
}

export function makeTrainHitIcon(
	offset: TrainMarkerOffset = ZERO_OFFSET,
): L.DivIcon {
	return L.divIcon(buildTrainHitIconSpec(offset));
}
