import { useLocale } from "../i18n";
import type { RealtimeHealth } from "../types";

type RealtimeBannerProps = {
	health: RealtimeHealth | null;
};

function formatAgeSeconds(ageSec: number | null): string {
	if (ageSec === null || ageSec < 0) return "?";
	if (ageSec < 60) return `${ageSec}s`;
	return `${Math.round(ageSec / 60)}m`;
}

export default function RealtimeBanner({ health }: RealtimeBannerProps) {
	const { t } = useLocale();
	if (!health || health.status === "ok") return null;

	const label =
		health.status === "unavailable"
			? t("bus.realtime.unavailable")
			: t("bus.realtime.stale", { time: formatAgeSeconds(health.ageSec) });

	return (
		<div
			className={`realtime-banner realtime-banner--${health.status}`}
			role="status"
			aria-live="polite"
		>
			{label}
		</div>
	);
}
