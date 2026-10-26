import { Scissors } from "lucide-preact";
import { useEffect, useRef, useState } from "react";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";

const SEEN_KEY = "puca:halloween-2026-10-26-seen";

export function isHalloweenEventActive(now = new Date()): boolean {
	// Dublin is on UTC throughout Oct 26–31, following the Oct 25 clock change.
	return (
		now >= new Date("2026-10-26T00:00:00Z") &&
		now < new Date("2026-11-01T00:00:00Z")
	);
}

// Allow a manual preview on Oct 25 without showing the announcement early.
export function canOpenHalloweenNotice(now = new Date()): boolean {
	return (
		now >= new Date("2026-10-24T23:00:00Z") &&
		now < new Date("2026-11-01T00:00:00Z")
	);
}

export function shouldShowHalloweenNotice(now = new Date()): boolean {
	if (!isHalloweenEventActive(now)) return false;
	try {
		return localStorage.getItem(SEEN_KEY) !== "1";
	} catch {
		return true;
	}
}

export function markHalloweenNoticeSeen(now = new Date()) {
	if (!isHalloweenEventActive(now)) return;
	try {
		localStorage.setItem(SEEN_KEY, "1");
	} catch {}
}

// A phone can resume the same PWA page days later without mounting App again.
export function watchHalloweenNotice(onAvailable: () => void): () => void {
	const check = () => {
		if (!document.hidden && shouldShowHalloweenNotice()) onAvailable();
	};
	document.addEventListener("visibilitychange", check);
	window.addEventListener("pageshow", check);
	check();
	return () => {
		document.removeEventListener("visibilitychange", check);
		window.removeEventListener("pageshow", check);
	};
}

export default function HalloweenNotice({ onClose }: { onClose: () => void }) {
	const { t, locale } = useLocale();
	const dialogRef = useRef<HTMLDialogElement>(null);
	const [cutting, setCutting] = useState(false);
	const cutStarted = useRef(false);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);
	const posterSrc = `/halloween-notice-${locale}.webp?v=oct26-1`;

	function startCut() {
		if (cutStarted.current) return;
		cutStarted.current = true;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			onClose();
			return;
		}
		setCutting(true);
		// Still leave the notice if an animation is interrupted or disabled.
		closeTimer.current = setTimeout(onClose, 1400);
	}
	useBackToClose(onClose);
	useEffect(() => {
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => {
			clearTimeout(closeTimer.current);
			dialog?.close();
		};
	}, []);

	return (
		<dialog
			ref={dialogRef}
			className={`halloween-notice${cutting ? " halloween-notice--cutting" : ""}`}
			aria-labelledby="halloween-title"
			aria-describedby="halloween-description"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="halloween-notice__accessible">
				<h2 id="halloween-title">{t("halloween.title")}</h2>
				<p id="halloween-description">
					{t("halloween.dates")}. {t("halloween.body")} {t("halloween.sound")}{" "}
					{t("halloween.footer")}
				</p>
			</div>
			<img
				className="halloween-notice__poster halloween-notice__poster--top"
				src={posterSrc}
				width={720}
				height={locale === "zh" ? 1353 : 1355}
				alt=""
				aria-hidden="true"
			/>
			<div
				className="halloween-notice__stub"
				aria-hidden="true"
				onAnimationEnd={(event) => {
					if (event.target === event.currentTarget && cutting) onClose();
				}}
			>
				<img
					className="halloween-notice__poster halloween-notice__poster--stub"
					src={posterSrc}
					alt=""
				/>
			</div>
			{cutting && (
				<Scissors
					className="halloween-notice__scissors"
					size={22}
					aria-hidden="true"
				/>
			)}
			<button
				type="button"
				className="halloween-notice__close"
				aria-label={t("halloween.close")}
				onClick={onClose}
			/>
			<button
				type="button"
				className="halloween-notice__cta"
				aria-label={t("halloween.cta")}
				disabled={cutting}
				onClick={startCut}
			/>
		</dialog>
	);
}
