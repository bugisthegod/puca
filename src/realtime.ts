import type { RealtimeHealth } from "./types";

export const REALTIME_STATUS_HEADER = "X-Puca-Realtime-Status";
export const REALTIME_AGE_HEADER = "X-Puca-Realtime-Age-Sec";

export function readRealtimeHealth(res: Response): RealtimeHealth {
	const status = res.headers.get(REALTIME_STATUS_HEADER);
	const ageRaw = res.headers.get(REALTIME_AGE_HEADER);
	const originAgeSec = ageRaw === null ? null : Number(ageRaw);
	const cdnAgeRaw = res.headers.get("Age");
	const cdnAgeSec = cdnAgeRaw === null ? 0 : Number(cdnAgeRaw);
	const ageSec =
		originAgeSec !== null && Number.isFinite(originAgeSec)
			? originAgeSec + (Number.isFinite(cdnAgeSec) ? cdnAgeSec : 0)
			: null;
	return {
		status: status === "stale" || status === "unavailable" ? status : "ok",
		ageSec,
	};
}
