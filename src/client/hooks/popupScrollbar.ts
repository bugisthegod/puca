// Overlay the thumb so desktop tables do not reserve an empty gutter.
export function attachPopupScrollbar(wrap: HTMLElement): void {
	if (wrap.parentElement?.classList.contains("popup-table-shell")) return;
	const shell = document.createElement("div");
	shell.className = "popup-table-shell";
	wrap.before(shell);
	shell.append(wrap);
	const thumb = document.createElement("div");
	thumb.className = "popup-scroll-thumb";
	thumb.setAttribute("aria-hidden", "true");
	shell.append(thumb);
	const update = () => {
		const range = wrap.scrollHeight - wrap.clientHeight;
		thumb.hidden = range <= 0;
		const top =
			(wrap.querySelector("thead")?.getBoundingClientRect().height ?? 0) + 4;
		const track = Math.max(0, wrap.clientHeight - top - 4);
		const height = Math.min(
			track,
			Math.max(28, (track * wrap.clientHeight) / wrap.scrollHeight),
		);
		thumb.style.height = `${height}px`;
		thumb.style.top = `${top + (range > 0 ? (wrap.scrollTop / range) * (track - height) : 0)}px`;
	};
	wrap.addEventListener("scroll", update, { passive: true });
	thumb.addEventListener("pointerdown", (event) => {
		event.preventDefault();
		const start = event.clientY;
		const scroll = wrap.scrollTop;
		const range = wrap.scrollHeight - wrap.clientHeight;
		const travel =
			wrap.clientHeight -
			(wrap.querySelector("thead")?.getBoundingClientRect().height ?? 0) -
			8 -
			thumb.offsetHeight;
		thumb.setPointerCapture(event.pointerId);
		const move = (next: PointerEvent) => {
			if (travel > 0)
				wrap.scrollTop = scroll + ((next.clientY - start) * range) / travel;
		};
		const end = () => {
			thumb.removeEventListener("pointermove", move);
			thumb.removeEventListener("lostpointercapture", end);
		};
		thumb.addEventListener("pointermove", move);
		thumb.addEventListener("lostpointercapture", end);
	});
	update();
}
