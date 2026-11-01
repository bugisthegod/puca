import {
	ArrowUpRight,
	ChevronLeft,
	ChevronRight,
	Volume2,
	X,
} from "lucide-preact";
import { useEffect, useRef, useState } from "react";
import { playHalloweenSound, stopHalloweenSound } from "../halloweenSound";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";
import HalloweenTicket from "./HalloweenTicket";

const ASSET_ROOT = "/events/halloween-2026";
const CHARACTERS = [
	["pumpkin-marker.png", "halloween.archive.pumpkin", "pumpkin"],
	["bat-marker.png", "halloween.archive.bat", "bat"],
	["witch-marker.png", "halloween.archive.witch", "witch"],
	["train-marker.png", "halloween.archive.train", "train"],
	["puca-halloween.png", "halloween.archive.puca", null],
	["puca-sleeping-halloween.png", "halloween.archive.sleeping", null],
] as const;
const CARD_COUNT = CHARACTERS.length + 1;

export default function HalloweenArchive() {
	const { t } = useLocale();
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const trackRef = useRef<HTMLDivElement>(null);
	const dialogRef = useRef<HTMLDialogElement>(null);
	useBackToClose(() => setOpen(false), open);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (open) dialog?.showModal();
		else dialog?.close();
		return () => {
			dialog?.close();
			stopHalloweenSound();
		};
	}, [open]);

	function goTo(index: number) {
		const track = trackRef.current;
		const card = track?.children[index] as HTMLElement | undefined;
		if (!track || !card) return;
		track.scrollTo({
			left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "instant"
				: "smooth",
		});
	}

	return (
		<section
			className="halloween-archive"
			aria-label={t("halloween.archive.label")}
		>
			<button
				type="button"
				className="about-halloween-link"
				aria-haspopup="dialog"
				aria-controls="halloween-archive-cards"
				onClick={() => {
					setOpen(!open);
					setActive(0);
				}}
			>
				<img
					src={`${ASSET_ROOT}/puca-halloween.png`}
					width={48}
					height={48}
					alt=""
				/>
				<span className="about-halloween-link__copy">
					<strong>{t("halloween.archive.title")}</strong>
					<small>10.26 — 10.31 · 2026</small>
				</span>
				<span className="halloween-archive__badge">
					{t("halloween.archive.ended")}
				</span>
				<ArrowUpRight size={18} aria-hidden="true" />
			</button>
			<dialog
				id="halloween-archive-cards"
				className="halloween-archive__dialog"
				ref={dialogRef}
				aria-labelledby="halloween-archive-title"
				aria-describedby="halloween-archive-description"
				onCancel={(event) => {
					event.preventDefault();
					setOpen(false);
				}}
				onKeyDown={(event) => event.stopPropagation()}
				onClick={(event) => {
					event.stopPropagation();
					if (event.target === event.currentTarget) setOpen(false);
				}}
			>
				{open && (
					<div className="halloween-archive__body">
						<header className="halloween-archive__header">
							<h2
								id="halloween-archive-title"
								className="halloween-archive__accessible"
							>
								{t("halloween.archive.title")}
							</h2>
							<button
								type="button"
								className="halloween-archive__close"
								aria-label={t("about.close")}
								onClick={() => setOpen(false)}
							>
								<X size={20} aria-hidden="true" />
							</button>
						</header>
						<p
							id="halloween-archive-description"
							className="halloween-archive__accessible"
						>
							{t("halloween.archive.intro")}
						</p>
						<section
							className="halloween-archive__track"
							ref={trackRef}
							aria-label={t("halloween.archive.cards")}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable gallery supports arrow-key navigation.
							tabIndex={0}
							onKeyDown={(event) => {
								if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
									return;
								event.preventDefault();
								goTo(
									Math.max(
										0,
										Math.min(
											CARD_COUNT - 1,
											active + (event.key === "ArrowRight" ? 1 : -1),
										),
									),
								);
							}}
							onScroll={(event) => {
								const track = event.currentTarget;
								const center = track.scrollLeft + track.clientWidth / 2;
								let closest = 0;
								let distance = Infinity;
								Array.from(track.children).forEach((child, index) => {
									const card = child as HTMLElement;
									const delta = Math.abs(
										card.offsetLeft + card.clientWidth / 2 - center,
									);
									if (delta < distance) {
										closest = index;
										distance = delta;
									}
								});
								if (closest !== active) {
									stopHalloweenSound();
									setActive(closest);
								}
							}}
						>
							<figure className="halloween-archive__card halloween-archive__card--ticket">
								<HalloweenTicket
									key={active === 0 ? "active" : "inactive"}
									onClose={() => setOpen(false)}
								/>
								<figcaption>{t("halloween.archive.ticket")}</figcaption>
							</figure>
							{CHARACTERS.map(([file, label, sound]) => {
								const art = (
									<>
										<img src={`${ASSET_ROOT}/${file}`} alt="" loading="lazy" />
										{file === "pumpkin-marker.png" && (
											<span className="halloween-archive__route">150</span>
										)}
										{sound && (
											<span className="halloween-archive__sound-hint">
												<Volume2 size={16} aria-hidden="true" />
												{t("halloween.archive.tapSound")}
											</span>
										)}
									</>
								);
								return (
									<figure className="halloween-archive__card" key={file}>
										{sound ? (
											<button
												type="button"
												className="halloween-archive__art halloween-archive__sound"
												aria-label={t("halloween.archive.playSound", {
													character: t(label),
												})}
												onClick={() => void playHalloweenSound(sound)}
											>
												{art}
											</button>
										) : (
											<div className="halloween-archive__art">{art}</div>
										)}
										<figcaption>{t(label)}</figcaption>
									</figure>
								);
							})}
						</section>
						<div className="halloween-archive__nav">
							<button
								type="button"
								onClick={() => goTo(active - 1)}
								disabled={active === 0}
								aria-label={t("halloween.archive.previous")}
							>
								<ChevronLeft size={18} />
							</button>
							<span aria-live="polite" aria-atomic="true">
								{active + 1} / {CARD_COUNT}
							</span>
							<button
								type="button"
								onClick={() => goTo(active + 1)}
								disabled={active === CARD_COUNT - 1}
								aria-label={t("halloween.archive.next")}
							>
								<ChevronRight size={18} />
							</button>
						</div>
					</div>
				)}
			</dialog>
		</section>
	);
}
