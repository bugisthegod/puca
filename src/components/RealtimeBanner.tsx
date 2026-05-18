import { useLocale } from "../i18n";
import type { RealtimeHealth } from "../types";

type RealtimeBannerProps = {
	health: RealtimeHealth | null;
};

export default function RealtimeBanner({ health }: RealtimeBannerProps) {
	const { t } = useLocale();
	if (!health || health.status === "ok") return null;

	return (
		<div
			className={`realtime-banner realtime-banner--${health.status}`}
			role="status"
			aria-live="polite"
		>
			{t("bus.realtime.unavailable")}
		</div>
	);
}
