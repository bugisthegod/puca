import type { RealtimeHealth } from "../../types";
import { useLocale } from "../i18n";

type RealtimeBannerProps = {
	health: RealtimeHealth | null;
};

export default function RealtimeBanner({ health }: RealtimeBannerProps) {
	const { t } = useLocale();
	if (!health || health.status === "ok") return null;
	const messageKey =
		health.status === "route-mismatch"
			? "bus.realtime.routeMismatch"
			: "bus.realtime.unavailable";

	return (
		<div
			className={`realtime-banner realtime-banner--${health.status}`}
			role="status"
			aria-live="polite"
		>
			{t(messageKey)}
		</div>
	);
}
