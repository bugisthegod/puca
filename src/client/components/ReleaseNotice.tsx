import { ArrowRight, ChevronDown, X } from "lucide-preact";
import { useLayoutEffect, useRef } from "react";
import { useBackToClose } from "../hooks/useBackToClose";
import { useLocale } from "../i18n";
import { latestRelease, releaseHistory } from "../releases";

export default function ReleaseNotice({ onClose }: { onClose: () => void }) {
	const { locale, t } = useLocale();
	const dialog = useRef<HTMLDialogElement>(null);
	const notes = latestRelease.notes[locale];
	useBackToClose(onClose);
	// Open in the same paint that removes About, keeping the backdrop continuous.
	useLayoutEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => element?.close();
	}, []);

	return (
		<dialog
			ref={dialog}
			className="release-notice"
			aria-labelledby="release-title"
			aria-describedby="release-body"
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
		>
			<header className="release-notice__header">
				<div className="release-notice__brand">
					<span>Púca</span>
					<span className="release-notice__edition">{t("release.title")}</span>
				</div>
				<button
					className="release-notice__close"
					type="button"
					onClick={onClose}
					aria-label={t("about.close")}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</header>
			<div className="release-notice__scroll">
				<img
					className="release-notice__illustration"
					src="/updates/puca-dublin-46a.webp?v=watercolor-edges-3"
					width="1774"
					height="887"
					alt=""
				/>
				<div className="release-notice__body">
					<p className="release-notice__eyebrow">{t("release.feature")}</p>
					<h2 id="release-title">{notes.title}</h2>
					<p id="release-body">{notes.body}</p>
					<div className="release-notice__preview">
						<div className="release-notice__preview-head">
							<span>{t("release.preview")}</span>
							<span>{t("popup.bus.col.exp")}</span>
						</div>
						<div className="release-notice__stop release-notice__stop--skipped">
							<span className="release-notice__dot" />
							<s>{t("release.stop.skipped")}</s>
							<span className="release-notice__badge">
								{t("popup.bus.skipped")}
							</span>
						</div>
						<div className="release-notice__stop">
							<span className="release-notice__dot" />
							<span>{t("release.stop.next")}</span>
							<span className="release-notice__time">14:53</span>
						</div>
					</div>
					<p className="release-notice__detail">{notes.detail}</p>
					<details className="release-notice__history">
						<summary>
							<span>{t("release.history")}</span>
							<span className="release-notice__history-count">
								{releaseHistory.length}
							</span>
							<ChevronDown size={14} aria-hidden="true" />
						</summary>
						<ol className="release-notice__timeline">
							{releaseHistory.map((release) => (
								<li key={release.id}>
									<time dateTime={release.date}>{release.date}</time>
									<h3>{release.notes[locale].title}</h3>
									<p>{release.notes[locale].body}</p>
								</li>
							))}
						</ol>
					</details>
				</div>
			</div>
			<footer className="release-notice__footer">
				<button
					className="release-notice__dismiss"
					type="button"
					onClick={onClose}
				>
					{t("release.dismiss")}
					<ArrowRight size={18} aria-hidden="true" />
				</button>
				<time className="release-notice__date" dateTime={latestRelease.date}>
					{latestRelease.date}
				</time>
			</footer>
		</dialog>
	);
}
