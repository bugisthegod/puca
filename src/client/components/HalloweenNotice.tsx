import { useEffect, useRef } from "react";
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

export function shouldShowHalloweenNotice(): boolean {
	if (!isHalloweenEventActive()) return false;
	try {
		return localStorage.getItem(SEEN_KEY) !== "1";
	} catch {
		return true;
	}
}

export function markHalloweenNoticeSeen() {
	if (!isHalloweenEventActive()) return;
	try {
		localStorage.setItem(SEEN_KEY, "1");
	} catch {}
}

export default function HalloweenNotice({ onClose }: { onClose: () => void }) {
	const { t, locale } = useLocale();
	const dialogRef = useRef<HTMLDialogElement>(null);
	useBackToClose(onClose);
	useEffect(() => {
		const dialog = dialogRef.current;
		dialog?.showModal();
		return () => dialog?.close();
	}, []);

	return (
		<dialog
			ref={dialogRef}
			className="halloween-notice"
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
				className="halloween-notice__poster"
				src={`/halloween-notice-${locale}.webp?v=oct26-1`}
				alt=""
				aria-hidden="true"
			/>
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
				onClick={onClose}
			/>
		</dialog>
	);
}
