export function cleanupDeprecatedSettings(): void {
	try {
		localStorage.removeItem("puca:theme");
		localStorage.removeItem("puca:fab-side");
	} catch {}
}
