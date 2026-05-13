// Front-view train cab face used by vehicle markers. Body fill uses currentColor
// so the dynamic markerColor (gray/green/orange/red by lateness) can be injected
// via inline style on the wrapping divIcon.
export const TRAIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 4 Q2 1 5 1 H15 Q18 1 18 4 V18 H2 Z" fill="currentColor"/><path d="M4 4 H16 V10 H4 Z" fill="rgba(255,255,255,0.95)"/><path d="M4 4 L4.5 3 H15.5 L16 4 Z" fill="rgba(255,255,255,0.95)"/><line x1="10" y1="3" x2="10" y2="10" stroke="currentColor" stroke-width="0.6"/><rect x="2" y="11" width="16" height="1" fill="rgba(0,0,0,0.22)"/><rect x="8" y="13" width="4" height="5" fill="rgba(0,0,0,0.18)" rx="0.5"/><circle cx="4.5" cy="15.5" r="1.3" fill="#fff5b8"/><circle cx="15.5" cy="15.5" r="1.3" fill="#fff5b8"/></svg>`;

export type TrainIconSpec = {
	className: string;
	html: string;
	iconSize: [number, number];
	iconAnchor: [number, number];
};

export function buildTrainIconSpec(color: string): TrainIconSpec {
	return {
		className: "train-marker",
		html: `<div class="train-icon" style="color:${color}">${TRAIN_SVG}</div>`,
		iconSize: [22, 22],
		iconAnchor: [11, 11],
	};
}

export function makeTrainIcon(color: string): L.DivIcon {
	return L.divIcon(buildTrainIconSpec(color));
}
