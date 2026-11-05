import type { Locale } from "./i18n";

// Publish a new ID and bilingual notes when shipping a user-facing feature.
// Keep this independent of deploy IDs so data-only deploys do not show a notice.
export const latestRelease = {
	id: "2026-11-05-skipped-stops",
	date: "2026-11-05",
	notes: {
		en: {
			title: "Skipped stops, clearly marked.",
			body: "A heads-up before you head out. Tap a bus to see which stops it won’t be serving, straight from the live feed.",
			detail:
				"We also leave these journeys out of the affected stop’s arrivals, so you know which bus to wait for.",
		},
		zh: {
			title: "哪些站不停靠，一眼就知道。",
			body: "出门前，Púca 先帮你看一眼。点击公交车，即可看到实时数据标记的“不停靠”站点。",
			detail: "站点的到站列表也会排除这些班次，让你安心等真正会停靠的车。",
		},
	} satisfies Record<Locale, { title: string; body: string; detail: string }>,
};

// Keep previous feature announcements here when replacing latestRelease.
// Only latestRelease controls the automatic first-open notice.
export const releaseHistory = [
	{
		id: "2026-11-01-halloween-keepsakes",
		date: "2026-11-01",
		notes: {
			en: {
				title: "A little Halloween keepsake",
				body: "Halloween lives on in Past events. Revisit Púca’s seasonal characters, sounds and interactive keepsake cards from About.",
			},
			zh: {
				title: "把万圣节留作纪念",
				body: "“关于”新增往期活动入口，随时重温 Púca 的万圣节角色、音效和互动纪念卡。",
			},
		},
	},
	{
		id: "2026-10-26-halloween",
		date: "2026-10-26",
		notes: {
			en: {
				title: "Púca came out to play",
				body: "A Halloween map with playful vehicle characters, spooky sounds and a special event ticket, from October 26–31.",
			},
			zh: {
				title: "Púca 出来捣蛋啦",
				body: "10 月 26–31 日上线万圣节主题地图，带来节日车辆角色、趣味音效和专属活动票。",
			},
		},
	},
] satisfies Array<{
	id: string;
	date: string;
	notes: Record<Locale, { title: string; body: string }>;
}>;

export const RELEASE_SEEN_KEY = "puca:release-seen";
type ReleaseStorage = Pick<Storage, "getItem" | "setItem">;

export function hasUnreadRelease(storage?: ReleaseStorage): boolean {
	try {
		return (
			(storage ?? localStorage).getItem(RELEASE_SEEN_KEY) !== latestRelease.id
		);
	} catch {
		return true;
	}
}

export function markReleaseSeen(storage?: ReleaseStorage): void {
	try {
		(storage ?? localStorage).setItem(RELEASE_SEEN_KEY, latestRelease.id);
	} catch {}
}
