import type { RealtimeHealth } from "./types";

export const REALTIME_STATUS_HEADER = "X-Puca-Realtime-Status";
export const REALTIME_AGE_HEADER = "X-Puca-Realtime-Age-Sec";

export function readRealtimeHealth(res: Response): RealtimeHealth {
	const status = res.headers.get(REALTIME_STATUS_HEADER);
	const ageRaw = res.headers.get(REALTIME_AGE_HEADER);
	const ageSec = ageRaw === null ? null : Number(ageRaw);
	return {
		status: status === "stale" || status === "unavailable" ? status : "ok",
		ageSec: Number.isFinite(ageSec) ? ageSec : null,
	};
}
