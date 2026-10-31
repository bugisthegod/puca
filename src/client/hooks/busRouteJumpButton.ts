import type { BusOperator } from "../../types";

export function bindBusRouteJumpButton(
	root: ParentNode | undefined,
	onSelect: (route: string, direction: string, operator?: BusOperator) => void,
) {
	const button = root?.querySelector<HTMLButtonElement>(".popup-route-jump");
	if (!button) return;
	// A popup can open repeatedly without replacing its DOM. Replace the handler
	// rather than accumulating a listener on every popupopen event.
	button.onclick = () => {
		const route = decodeURIComponent(button.getAttribute("data-route") ?? "");
		const direction = button.getAttribute("data-dir") ?? "";
		const operator = (button.getAttribute("data-operator") || undefined) as
			| BusOperator
			| undefined;
		if (route && direction) onSelect(route, direction, operator);
	};
}
