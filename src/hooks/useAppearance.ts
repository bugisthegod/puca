export function applyInitialAppearance(): void {
	delete document.documentElement.dataset.theme;
	try {
		localStorage.removeItem("puca:theme");
		localStorage.removeItem("puca:fab-side");
	} catch {}
}
