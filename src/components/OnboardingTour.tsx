import type React from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import { useLocale } from "../i18n";

export interface TourStep {
	target?: string;
	title: string;
	body: string;
}

interface Props {
	steps: TourStep[];
	onClose: () => void;
}

const TOOLTIP_WIDTH = 280;
const HIGHLIGHT_PADDING = 8;
const TOOLTIP_GAP = 14;
const EDGE_MARGIN = 12;

export default function OnboardingTour({ steps, onClose }: Props) {
	const { t } = useLocale();
	const [index, setIndex] = useState(0);
	const [rect, setRect] = useState<DOMRect | null>(null);
	const [viewport, setViewport] = useState({
		w: window.innerWidth,
		h: window.innerHeight,
	});
	const step = steps[index] as TourStep | undefined;

	useLayoutEffect(() => {
		const target = step?.target;
		const update = () => {
			setViewport({ w: window.innerWidth, h: window.innerHeight });
			if (!target) {
				setRect(null);
				return;
			}
			const el = document.querySelector(target);
			setRect(el ? el.getBoundingClientRect() : null);
		};
		update();
		const interval = window.setInterval(update, 200); // catches layout shifts from async content
		window.addEventListener("resize", update);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("resize", update);
		};
	}, [step?.target]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "ArrowRight")
				setIndex((i) => Math.min(i + 1, steps.length - 1));
			else if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [onClose, steps.length]);

	if (!step) return null;

	const isLast = index === steps.length - 1;
	const next = () => (isLast ? onClose() : setIndex(index + 1));
	const back = () => setIndex(Math.max(0, index - 1));

	let highlightStyle: React.CSSProperties | null = null;
	let tooltipStyle: React.CSSProperties = {};
	let centered = false;

	if (rect) {
		highlightStyle = {
			top: rect.top - HIGHLIGHT_PADDING,
			left: rect.left - HIGHLIGHT_PADDING,
			width: rect.width + HIGHLIGHT_PADDING * 2,
			height: rect.height + HIGHLIGHT_PADDING * 2,
		};
		const placeBelow = rect.top + rect.height / 2 < viewport.h / 2;
		const rectCx = rect.left + rect.width / 2;
		const clampedLeft = Math.max(
			EDGE_MARGIN,
			Math.min(
				rectCx - TOOLTIP_WIDTH / 2,
				viewport.w - TOOLTIP_WIDTH - EDGE_MARGIN,
			),
		);
		tooltipStyle = placeBelow
			? {
					top: rect.bottom + HIGHLIGHT_PADDING + TOOLTIP_GAP,
					left: clampedLeft,
				}
			: {
					bottom: viewport.h - rect.top + HIGHLIGHT_PADDING + TOOLTIP_GAP,
					left: clampedLeft,
				};
	} else {
		centered = true;
	}

	return (
		<div
			className={`tour${centered ? " tour--no-target" : ""}`}
			role="dialog"
			aria-modal="true"
			aria-label={t("tour.aria")}
		>
			<div className="tour__backdrop" aria-hidden="true" />
			{highlightStyle && (
				<div className="tour__highlight" style={highlightStyle} />
			)}
			<div
				className={`tour__tooltip${centered ? " tour__tooltip--center" : ""}`}
				style={tooltipStyle}
			>
				<div className="tour__progress">
					{index + 1} / {steps.length}
				</div>
				<h3 className="tour__title">{step.title}</h3>
				<p className="tour__body">{step.body}</p>
				<div className="tour__actions">
					{isLast ? (
						<span className="tour__skip-spacer" />
					) : (
						<button type="button" className="tour__skip" onClick={onClose}>
							{t("tour.skip")}
						</button>
					)}
					<div className="tour__nav">
						{index > 0 && (
							<button
								type="button"
								className="tour__btn tour__btn--ghost"
								onClick={back}
							>
								{t("tour.back")}
							</button>
						)}
						<button
							type="button"
							className="tour__btn tour__btn--primary"
							onClick={next}
						>
							{isLast ? t("tour.gotit") : t("tour.next")}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
