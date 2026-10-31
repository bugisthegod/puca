import { Scissors } from "lucide-preact";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";

export default function HalloweenTicket({ onClose }: { onClose: () => void }) {
	const { locale, t } = useLocale();
	const [cutting, setCutting] = useState(false);
	const started = useRef(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const src = `/events/halloween-2026/halloween-notice-${locale}.webp`;

	useEffect(() => () => clearTimeout(timer.current), []);

	function startCut() {
		if (started.current) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			return;
		}
		started.current = true;
		setCutting(true);
		// The cut takes 1.8 seconds; leave a short pause before restoring it.
		timer.current = setTimeout(() => {
			setCutting(false);
			started.current = false;
		}, 2600);
	}

	return (
		<div className="halloween-ticket__frame">
			<div
				className={`halloween-ticket${cutting ? " halloween-ticket--cutting" : ""}`}
			>
				<img
					className="halloween-ticket__top"
					src={src}
					alt={t("halloween.archive.ticketAlt")}
				/>
				<div className="halloween-ticket__stub" aria-hidden="true">
					<img src={src} alt="" />
				</div>
				{cutting && (
					<Scissors
						className="halloween-ticket__scissors"
						size={22}
						aria-hidden="true"
					/>
				)}
				<button
					type="button"
					className="halloween-ticket__close"
					aria-label={t("about.close")}
					onClick={onClose}
				/>
				<button
					type="button"
					className="halloween-ticket__cta"
					aria-label={t("halloween.archive.cutTicket")}
					disabled={cutting}
					onClick={startCut}
				/>
			</div>
		</div>
	);
}
