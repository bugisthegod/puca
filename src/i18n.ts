import { useEffect, useReducer } from "react";

export type Locale = "en" | "zh";

const STORAGE_KEY = "puca:locale";

function detectInitial(): Locale {
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		if (v === "en" || v === "zh") return v;
	} catch {}
	if (typeof navigator !== "undefined") {
		const lang = (navigator.language || "").toLowerCase();
		if (lang.startsWith("zh")) return "zh";
	}
	return "en";
}

let currentLocale: Locale = detectInitial();
const subscribers = new Set<() => void>();

function applyHtmlLang(l: Locale): void {
	if (typeof document !== "undefined") {
		document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
	}
}

applyHtmlLang(currentLocale);

export function getLocale(): Locale {
	return currentLocale;
}

export function setLocale(l: Locale): void {
	if (l === currentLocale) return;
	currentLocale = l;
	try {
		localStorage.setItem(STORAGE_KEY, l);
	} catch {}
	applyHtmlLang(l);
	subscribers.forEach((fn) => {
		fn();
	});
}

// Sync locale across tabs: the `storage` event only fires in *other* tabs,
// so writing localStorage above won't loop back here.
if (typeof window !== "undefined") {
	window.addEventListener("storage", (e) => {
		if (e.key === STORAGE_KEY && (e.newValue === "en" || e.newValue === "zh")) {
			setLocale(e.newValue);
		}
	});
}

const EN = {
	// AboutModal — chrome
	"about.dialog.aria": "About Púca",
	"about.close": "Close",
	"about.info.btn.aria": "About {label}",

	// AboutModal — hero
	"about.hero.subline": "Irish folklore",
	"about.hero.tag":
		"A shapeshifting spirit said to haunt Ireland's roads after dark — sometimes guiding weary travellers home, sometimes leading them astray for its own amusement. This map watches its modern cousins — trains and buses — as they flit across the island in real time.",

	// AboutModal — tour button
	"about.tour.btn": "Take the tour",

	"about.share.btn": "Share Púca",
	"about.share.copied": "Copied",
	"about.donate.btn": "Buy Púca a treat",
	"about.source.btn": "View source",

	// AboutModal — Language setting
	"about.lang.label": "Language",

	// AboutModal — Compass setting
	"about.compass.label": "Compass",
	"about.compass.info":
		"Shows which way you're facing on the map. Off by default; if your device asks for permission every time, keeping it off is recommended.",
	"about.compass.off": "Off",
	"about.compass.on": "On",

	// AboutModal — Install card
	"about.install.heading": "Install as an app",
	"about.install.btn": "Install Púca",
	"about.install.iphone.platform": "iPhone · Safari",
	"about.install.iphone.s1": "Tap the Share button.",
	"about.install.iphone.s2": "Scroll to <strong>Add to Home Screen</strong>.",
	"about.install.iphone.s3": "Tap <strong>Add</strong>.",
	"about.install.android.platform": "Android · Chrome",
	"about.install.android.s1": "Tap the menu (⋮).",
	"about.install.android.s2":
		"Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.",
	"about.install.note": "For a better experience, install to your home screen.",

	"about.feedback.btn": "Send feedback",

	// AboutModal — footer
	"about.footer.line1":
		"Data from Irish Rail and the National Transport Authority.",
	"about.footer.line2": "Not affiliated with either.",

	// Error boundary
	"error.title": "Oops, Púca broke something",
	"error.body": "A little gremlin snuck into the code. Give it another go?",
	"error.btn": "Try again",

	// OnboardingTour
	"tour.aria": "Guided tour",
	"tour.skip": "Skip",
	"tour.back": "Back",
	"tour.next": "Next",
	"tour.gotit": "Got it",
	"tour.welcome.title": "Welcome to Púca",
	"tour.welcome.body":
		"A live map for Ireland's trains and buses, with routes, stops, arrivals, and favourites. Quick tour — takes 20 seconds.",
	"tour.mode.title": "Switch mode",
	"tour.mode.body": "Switch between Train, Bus, and Luas.",
	"tour.search.title": "Search",
	"tour.search.body":
		"Search trains between stations, or find buses by route, stop number, or stop name.",
	"tour.tap.title": "Tap a vehicle",
	"tour.tap.body":
		"Tap any vehicle for live details, delays, stops, and route context.",
	"tour.settings.title": "Settings & help",
	"tour.settings.body":
		"Change language, toggle compass, get install tips, or revisit this tour.",
	"tour.favs.title": "Save favourites",
	"tour.favs.body":
		"Star bus routes, bus stops, or train searches, then open them from here.",
	"tour.locate.title": "Locate me",
	"tour.locate.body":
		"Centre the map on your location to see nearby vehicles and stops. You're all set!",

	// InfoPanel
	"info.mode.train": "Train",
	"info.mode.bus": "Bus",
	"info.mode.luas": "Luas",
	"info.running.bus": "{n} buses running",
	"info.kip": "Púca's having a kip",
	"info.offhours.status": "Out of service",
	"info.updated": "Updated: {time}",
	"info.updated.justnow": "just now",
	"info.updated.seconds": "{n}s ago",
	"info.updated.empty": "Updated: —",
	"info.updated.timetable": "Timetable",
	"info.stop.noarrivals": "No upcoming buses",
	"luas.line.green": "Green Line",
	"luas.line.red": "Red Line",
	"luas.line.both": "Luas",

	// Map overlays
	"map.empty.trains.title": "No live train positions",
	"map.empty.trains.body":
		"Train position data is temporarily unavailable. Try again later.",

	// SearchPanel (train)
	"train.search.placeholder.from": "From station...",
	"train.search.placeholder.to": "To station...",
	"train.search.swap.title": "Swap stations",
	"train.search.btn.search": "Search",
	"train.search.btn.searching": "Searching...",
	"train.search.btn.clear": "Clear",
	"train.search.fab.aria": "Search",
	"train.search.results.found.one": "Found 1 train",
	"train.search.results.found.many": "Found {n} trains",
	"train.search.results.empty": "No active trains on this route",
	"train.search.station.empty": "No matching stations",
	"train.focus.direction": "To {station}",
	"train.focus.departsIn": "Departs in {n} min",
	"train.focus.departing": "Departing now",
	"train.status.running": "Running",
	"train.status.ready": "Ready",
	"train.status.unmapped": "No position",
	"train.status.scheduled": "Scheduled",
	"train.toast.notonmap.title": "Not mapped yet",

	// App — back-to-all-buses button
	"bus.back.all": "All buses",
	"train.back.all": "All trains",
	"luas.back.all": "All stops",

	// BusSearchPanel
	"bus.search.placeholder.any": "Route or stop...",
	"bus.search.group.routes": "Routes",
	"bus.search.group.stops": "Stops",
	"bus.search.empty.any": "No matching routes or stops",
	"bus.search.fab.aria": "Search",
	"bus.search.going": "To {dest}",
	"bus.search.btn.change": "Change",
	"bus.search.loading.stop": "Loading stop…",
	"bus.search.arrivals.loading": "Loading…",
	"bus.search.arrivals.error": "Could not load arrivals",
	"bus.search.arrivals.empty": "No upcoming buses.",
	"bus.search.arrivals.unavailable":
		"Live arrival data is temporarily unavailable. Please check again shortly.",
	"bus.search.arrivals.checking": "Checking location…",
	"bus.search.arrivals.maybePassed": "May have passed",
	"bus.search.eta.due": "Due",
	"bus.search.eta.min": "{n} min",
	"bus.search.stops.away": "{n} stops away",
	"bus.search.toast.notonmap.title": "Not mapped yet",

	// LuasSearchPanel
	"luas.search.placeholder": "Luas stop...",
	"luas.search.empty": "No matching Luas stops",
	"luas.search.fab.aria": "Search Luas stops",
	"luas.search.btn.change": "Change",
	"luas.search.arrivals.loading": "Loading…",
	"luas.search.arrivals.error": "Could not load Luas arrivals",
	"luas.search.arrivals.empty": "No upcoming Luas trams.",
	"luas.search.eta.due": "Due",
	"luas.search.eta.min": "{n} min",

	// FavoritesModal
	"favs.dialog.aria": "Favorites",
	"favs.title": "Favorites",
	"favs.empty":
		"No favorites yet. Tap the star next to a bus direction, train search, bus stop, or Luas stop to save it.",
	"favs.section.buses": "Buses",
	"favs.section.stops": "Bus stops",
	"favs.section.luasStops": "Luas stops",
	"favs.section.trains": "Trains",
	"favs.section.moveUp.title": "Move up",
	"favs.section.moveDown.title": "Move down",
	"favs.section.moveUp.aria": "Move {name} section up",
	"favs.section.moveDown.aria": "Move {name} section down",
	"favs.section.edit": "Edit",
	"favs.section.edit.done": "Done",
	"favs.item.drag.title": "Drag to reorder",
	"favs.item.drag.aria": "Drag {name} to reorder",
	"favs.luas.next.loading": "Checking next tram…",
	"favs.luas.next.timing": "{eta}",
	"favs.luas.next.empty": "No upcoming trams",
	"favs.luas.next.error": "Could not load next tram",
	"favs.remove.title": "Remove",
	"favs.remove.confirm": "Remove",
	"favs.remove.cancel": "Cancel",
	"favs.remove.bus.aria": "Remove {name} from favorites",
	"favs.remove.bus.confirm.aria": "Confirm removing {name} from favorites",
	"favs.remove.stop.aria": "Remove {name} from favorites",
	"favs.remove.stop.confirm.aria": "Confirm removing {name} from favorites",
	"favs.remove.luasStop.aria": "Remove {name} from favorites",
	"favs.remove.luasStop.confirm.aria": "Confirm removing {name} from favorites",
	"favs.remove.train.aria": "Remove {from} to {to} from favorites",
	"favs.remove.train.confirm.aria":
		"Confirm removing {from} to {to} from favorites",

	// App-level toasts
	"toast.location.off.title": "Location is off",
	"toast.location.off.body": "Enable it in your device settings",
	"toast.location.unavailable.title": "Location unavailable",
	"toast.location.unavailable.body": "Try again in a moment",
	"toast.location.timeout.title": "Timed out",
	"toast.location.timeout.body": "Try again",
	"toast.location.unknown.title": "Couldn't get your location",
	"toast.location.lowAccuracy.title": "Location accuracy is low",
	"toast.location.lowAccuracy.body":
		"Wait a moment or enable precise location.",
	"toast.fav.full": "Favorites full ({max} max). Remove one first.",

	// FAB buttons
	"fab.locate.aria": "Locate me",
	"fab.favs.aria": "Favorites",
	"fab.about.aria": "About Púca",

	// Popup — shared status (train + bus)
	"popup.status.ontime": "On time",
	"popup.status.early.one": "On time (1 min early)",
	"popup.status.early.many": "On time ({n} mins early)",
	"popup.status.late.one": "1 min late",
	"popup.status.late.many": "{n} mins late",

	// Popup — train
	"popup.train.status.notrunning": "Not yet running",
	"popup.train.status.terminated": "Terminated",
	"popup.train.status.running": "Running",
	"popup.train.loading": "Loading stops…",
	"popup.train.error": "Could not load movement data.",
	"popup.train.col.station": "Station",
	"popup.train.col.type": "Note",
	"popup.train.col.arr": "Arr",
	"popup.train.col.dep": "Dep",
	"popup.train.stoptype.O": "Origin",
	"popup.train.stoptype.T": "Terminus",
	"popup.train.stoptype.C": "Current",
	"popup.train.stoptype.N": "Next",
	"popup.train.stoptype.S": "Stop",
	"popup.train.stoptype.D": "Destination",

	// Popup — bus
	"popup.bus.loading": "Loading stops…",
	"popup.bus.empty": "No upcoming stop data available.",
	"popup.bus.showall": "Show all {route}",
	"popup.bus.vehicle": "Vehicle {label}",
	"popup.bus.stale.title": "Púca ran off with this bus",
	"popup.bus.stale.body": "Heh heh, times below may be off.",
	"popup.bus.col.num": "#",
	"popup.bus.col.stop": "Stop",
	"popup.bus.col.sched": "Sched",
	"popup.bus.col.exp": "Exp",

	// Offline
	"offline.banner": "Offline — showing cached data",
	"bus.realtime.unavailable":
		"Live bus data is temporarily unavailable. Please check again shortly.",
	"bus.realtime.routeMismatch":
		"Some live bus locations may be missing. Please check again shortly.",
} as const;

type Key = keyof typeof EN;

const ZH: Record<Key, string> = {
	// AboutModal — chrome
	"about.dialog.aria": "关于 Púca",
	"about.close": "关闭",
	"about.info.btn.aria": "关于 {label}",

	// AboutModal — hero
	"about.hero.subline": "爱尔兰民间传说",
	"about.hero.tag":
		"Púca 是爱尔兰民间传说中的变形精灵，常在夜色降临后游荡于爱尔兰的道路 —— 有时为疲惫的旅人指路回家，有时却为消遣引人误入歧途。这张地图实时追踪它的现代亲戚 —— 在岛上来回穿梭的列车与公交。",

	// AboutModal — tour button
	"about.tour.btn": "查看引导",

	"about.share.btn": "分享 Púca",
	"about.share.copied": "已复制",
	"about.donate.btn": "请 Púca 吃颗糖",
	"about.source.btn": "查看源码",

	// AboutModal — Language setting
	"about.lang.label": "语言",

	// AboutModal — Compass setting
	"about.compass.label": "指南针",
	"about.compass.info":
		"在地图上显示你面朝的方向。默认关闭；如果设备每次都弹权限提醒，建议保持关闭。",
	"about.compass.off": "关",
	"about.compass.on": "开",

	// AboutModal — Install card
	"about.install.heading": "安装为应用",
	"about.install.btn": "安装 Púca",
	"about.install.iphone.platform": "iPhone · Safari",
	"about.install.iphone.s1": "点击分享按钮。",
	"about.install.iphone.s2": "滚动至<strong>添加到主屏幕</strong>。",
	"about.install.iphone.s3": "点击<strong>添加</strong>。",
	"about.install.android.platform": "Android · Chrome",
	"about.install.android.s1": "点击菜单（⋮）。",
	"about.install.android.s2":
		"点击<strong>安装应用</strong>或<strong>添加到主屏幕</strong>。",
	"about.install.note": "为了更好的体验，建议添加到主屏幕。",

	"about.feedback.btn": "发送反馈",

	// AboutModal — footer
	"about.footer.line1":
		"数据来源：Irish Rail 与 National Transport Authority。",
	"about.footer.line2": "本应用与两者均无关联。",

	// Error boundary
	"error.title": "糟糕，Púca 出了点问题",
	"error.body": "代码里溜进了一只小精灵。再试一次？",
	"error.btn": "再试一次",

	// OnboardingTour
	"tour.aria": "引导教程",
	"tour.skip": "跳过",
	"tour.back": "上一步",
	"tour.next": "下一步",
	"tour.gotit": "完成",
	"tour.welcome.title": "欢迎使用 Púca",
	"tour.welcome.body":
		"爱尔兰列车与公交实时地图，支持线路、站点、到站与收藏。快速引导，20 秒搞定。",
	"tour.mode.title": "切换模式",
	"tour.mode.body": "在列车、公交和电车间切换。",
	"tour.search.title": "搜索",
	"tour.search.body": "查找两站之间的列车，或按线路、站号、站名搜索公交。",
	"tour.tap.title": "点击车辆",
	"tour.tap.body": "点击任意车辆，查看实时详情、延误、停靠站与线路信息。",
	"tour.settings.title": "设置与帮助",
	"tour.settings.body": "切换语言、开关指南针，查看安装提示，或重温引导。",
	"tour.favs.title": "保存收藏",
	"tour.favs.body": "收藏公交线路、公交站或列车搜索，下次可从这里直接打开。",
	"tour.locate.title": "定位我",
	"tour.locate.body":
		"将地图定位到你的位置，查看附近车辆和站点。一切准备就绪！",

	// InfoPanel
	"info.mode.train": "列车",
	"info.mode.bus": "公交",
	"info.mode.luas": "电车",
	"info.running.bus": "{n} 辆公交运行中",
	"info.kip": "Púca 在打盹",
	"info.offhours.status": "非营运",
	"info.updated": "更新于 {time}",
	"info.updated.justnow": "刚刚",
	"info.updated.seconds": "{n} 秒前",
	"info.updated.empty": "更新于 —",
	"info.updated.timetable": "时刻表",
	"info.stop.noarrivals": "暂无即将到站的公交",
	"luas.line.green": "绿线",
	"luas.line.red": "红线",
	"luas.line.both": "电车",

	// Map overlays
	"map.empty.trains.title": "暂无实时列车位置",
	"map.empty.trains.body": "列车位置数据暂时不可用，请稍后再试。",

	// SearchPanel (train)
	"train.search.placeholder.from": "出发站...",
	"train.search.placeholder.to": "到达站...",
	"train.search.swap.title": "交换站点",
	"train.search.btn.search": "搜索",
	"train.search.btn.searching": "搜索中...",
	"train.search.btn.clear": "清除",
	"train.search.fab.aria": "搜索",
	"train.search.results.found.one": "找到 1 班列车",
	"train.search.results.found.many": "找到 {n} 班列车",
	"train.search.results.empty": "该线路暂无运行中的列车",
	"train.search.station.empty": "未找到匹配站点",
	"train.focus.direction": "开往 {station}",
	"train.focus.departsIn": "{n} 分钟后发车",
	"train.focus.departing": "即将发车",
	"train.status.running": "运行中",
	"train.status.ready": "待发",
	"train.status.unmapped": "暂无定位",
	"train.status.scheduled": "尚未运行",
	"train.toast.notonmap.title": "暂未上图",

	// App — back-to-all-buses button
	"bus.back.all": "全部公交",
	"train.back.all": "全部列车",
	"luas.back.all": "全部站点",

	// BusSearchPanel
	"bus.search.placeholder.any": "线路或站点...",
	"bus.search.group.routes": "线路",
	"bus.search.group.stops": "站点",
	"bus.search.empty.any": "未找到匹配线路或站点",
	"bus.search.fab.aria": "搜索",
	"bus.search.going": "终到 {dest}",
	"bus.search.btn.change": "更改",
	"bus.search.loading.stop": "加载站点…",
	"bus.search.arrivals.loading": "加载中…",
	"bus.search.arrivals.error": "无法加载到站信息",
	"bus.search.arrivals.empty": "暂无即将到站的公交。",
	"bus.search.arrivals.unavailable": "实时到站信息暂时不可用，请稍后再来查看。",
	"bus.search.arrivals.checking": "正在确认位置…",
	"bus.search.arrivals.maybePassed": "可能已过站",
	"bus.search.eta.due": "即将到站",
	"bus.search.eta.min": "{n} 分钟",
	"bus.search.stops.away": "还有 {n} 站",
	"bus.search.toast.notonmap.title": "暂未上图",

	// LuasSearchPanel
	"luas.search.placeholder": "电车站...",
	"luas.search.empty": "未找到匹配电车站",
	"luas.search.fab.aria": "搜索电车站",
	"luas.search.btn.change": "更改",
	"luas.search.arrivals.loading": "加载中…",
	"luas.search.arrivals.error": "无法加载电车到站信息",
	"luas.search.arrivals.empty": "暂无即将到站的电车。",
	"luas.search.eta.due": "即将到站",
	"luas.search.eta.min": "{n} 分钟",

	// FavoritesModal
	"favs.dialog.aria": "收藏",
	"favs.title": "收藏",
	"favs.empty":
		"还没有收藏。点击公交方向、列车搜索、公交站或电车站旁的星标即可保存。",
	"favs.section.buses": "公交",
	"favs.section.stops": "公交站",
	"favs.section.luasStops": "电车站",
	"favs.section.trains": "列车",
	"favs.section.moveUp.title": "上移",
	"favs.section.moveDown.title": "下移",
	"favs.section.moveUp.aria": "上移{name}模块",
	"favs.section.moveDown.aria": "下移{name}模块",
	"favs.section.edit": "编辑",
	"favs.section.edit.done": "完成",
	"favs.item.drag.title": "拖动排序",
	"favs.item.drag.aria": "拖动{name}排序",
	"favs.luas.next.loading": "正在查看下一班…",
	"favs.luas.next.timing": "{eta}",
	"favs.luas.next.empty": "暂无即将到站的电车",
	"favs.luas.next.error": "无法加载下一班",
	"favs.remove.title": "移除",
	"favs.remove.confirm": "移除",
	"favs.remove.cancel": "取消",
	"favs.remove.bus.aria": "从收藏中移除 {name}",
	"favs.remove.bus.confirm.aria": "确认从收藏中移除 {name}",
	"favs.remove.stop.aria": "从收藏中移除 {name}",
	"favs.remove.stop.confirm.aria": "确认从收藏中移除 {name}",
	"favs.remove.luasStop.aria": "从收藏中移除 {name}",
	"favs.remove.luasStop.confirm.aria": "确认从收藏中移除 {name}",
	"favs.remove.train.aria": "从收藏中移除 {from} 到 {to}",
	"favs.remove.train.confirm.aria": "确认从收藏中移除 {from} 到 {to}",

	// App-level toasts
	"toast.location.off.title": "定位已关闭",
	"toast.location.off.body": "请在设备设置中开启",
	"toast.location.unavailable.title": "无法获取定位",
	"toast.location.unavailable.body": "请稍后再试",
	"toast.location.timeout.title": "请求超时",
	"toast.location.timeout.body": "请重试",
	"toast.location.unknown.title": "无法获取你的位置",
	"toast.location.lowAccuracy.title": "定位精度较低",
	"toast.location.lowAccuracy.body": "请稍等片刻，或开启精确定位。",
	"toast.fav.full": "收藏已满（最多 {max} 个）。请先移除一个。",

	// FAB buttons
	"fab.locate.aria": "定位我",
	"fab.favs.aria": "收藏",
	"fab.about.aria": "关于 Púca",

	// Popup — shared status (train + bus)
	"popup.status.ontime": "准点",
	"popup.status.early.one": "准点（早 1 分钟）",
	"popup.status.early.many": "准点（早 {n} 分钟）",
	"popup.status.late.one": "晚 1 分钟",
	"popup.status.late.many": "晚 {n} 分钟",

	// Popup — train
	"popup.train.status.notrunning": "尚未发车",
	"popup.train.status.terminated": "已终止",
	"popup.train.status.running": "运行中",
	"popup.train.loading": "加载站点…",
	"popup.train.error": "无法加载车次数据。",
	"popup.train.col.station": "车站",
	"popup.train.col.type": "备注",
	"popup.train.col.arr": "到站",
	"popup.train.col.dep": "发车",
	"popup.train.stoptype.O": "起点",
	"popup.train.stoptype.T": "终点",
	"popup.train.stoptype.C": "当前",
	"popup.train.stoptype.N": "下站",
	"popup.train.stoptype.S": "经停",
	"popup.train.stoptype.D": "终到",

	// Popup — bus
	"popup.bus.loading": "加载站点…",
	"popup.bus.empty": "暂无即将到站的数据。",
	"popup.bus.showall": "显示全部 {route}",
	"popup.bus.vehicle": "车辆 {label}",
	"popup.bus.stale.title": "Púca 把这辆公交开跑了",
	"popup.bus.stale.body": "嘿嘿，下面的时间可能不准。",
	"popup.bus.col.num": "#",
	"popup.bus.col.stop": "站点",
	"popup.bus.col.sched": "计划",
	"popup.bus.col.exp": "预计",

	// Offline
	"offline.banner": "离线 — 显示缓存数据",
	"bus.realtime.unavailable": "实时公交数据暂时不可用，请稍后再来查看。",
	"bus.realtime.routeMismatch":
		"部分实时公交位置可能暂时缺失，请稍后再来查看。",
};

const STRINGS: Record<Locale, Record<Key, string>> = { en: EN, zh: ZH };

export function t(key: Key, params?: Record<string, string | number>): string {
	let s: string = STRINGS[currentLocale][key] ?? STRINGS.en[key] ?? key;
	if (params) {
		for (const [k, v] of Object.entries(params)) {
			s = s.split(`{${k}}`).join(String(v));
		}
	}
	return s;
}

export function useLocale(): {
	locale: Locale;
	setLocale: (l: Locale) => void;
	t: typeof t;
} {
	const [, force] = useReducer((x: number) => x + 1, 0);
	useEffect(() => {
		const sub = () => force(0);
		subscribers.add(sub);
		return () => {
			subscribers.delete(sub);
		};
	}, []);
	return { locale: currentLocale, setLocale, t };
}
