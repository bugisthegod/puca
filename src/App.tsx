import L from "leaflet";
import "leaflet.markercluster";
(window as unknown as { L: typeof L }).L = L;

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { isStandalonePwa, trackEvent } from "./analytics";
import AboutModal from "./components/AboutModal";
import BusSearchPanel, {
	type BusStopSummary,
} from "./components/BusSearchPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import FavoritesModal from "./components/FavoritesModal";
import InfoPanel from "./components/InfoPanel";
import OfflineBanner from "./components/OfflineBanner";
import OnboardingTour, { type TourStep } from "./components/OnboardingTour";
import PucaMark from "./components/PucaMark";
import RealtimeBanner from "./components/RealtimeBanner";
import SearchPanel from "./components/SearchPanel";
import {
	type BusFavorite,
	type BusStopFavorite,
	hasBus,
	hasStop,
	hasTrain,
	MAX_FAVORITES,
	type TrainFavorite,
	totalFavorites,
} from "./favorites";
import { cleanupDeprecatedSettings } from "./hooks/useAppearance";
import { useFavorites } from "./hooks/useFavorites";
import { useToast } from "./hooks/useToast";
import { type Mode, useVehicleMap } from "./hooks/useVehicleMap";
import { useVehiclePolling } from "./hooks/useVehiclePolling";
import { useLocale } from "./i18n";
import {
	type BusSearchTab,
	clearBusSearchSession,
	loadBusSearchSession,
	loadSession,
	saveSession,
} from "./session";
import { registerServiceWorker } from "./sw-register";
import type {
	BusOperator,
	BusShape,
	FocusContext,
	TrainFocusSummary,
} from "./types";
import type { Filter } from "./utils";
import "./style.css";

const LOW_LOCATION_ACCURACY_M = 500;

const savedSession = loadSession();
const savedBusSearch = loadBusSearchSession();
const ABOUT_SEEN_KEY = "puca:about-seen";
const TOUR_SEEN_KEY = "puca:tour-seen-v1";

// Clean up deprecated localStorage keys from removed features.
cleanupDeprecatedSettings();

// iOS (Safari/WebKit) is the only platform that gates device orientation
// behind a per-page-load permission prompt — Android just works. Use the
// presence of requestPermission() as the signal so we surface the compass
// toggle only where the user needs it to re-grant after each reload.
const needsCompassToggle =
	typeof DeviceOrientationEvent !== "undefined" &&
	typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown })
		.requestPermission === "function";

function App() {
	const { t } = useLocale();
	const tourSteps: TourStep[] = [
		{
			title: t("tour.welcome.title"),
			body: t("tour.welcome.body"),
		},
		{
			target: "#info-panel",
			title: t("tour.mode.title"),
			body: t("tour.mode.body"),
		},
		{
			target: "#search-panel",
			title: t("tour.search.title"),
			body: t("tour.search.body"),
		},
		{
			title: t("tour.tap.title"),
			body: t("tour.tap.body"),
		},
		{
			target: ".about-fab",
			title: t("tour.settings.title"),
			body: t("tour.settings.body"),
		},
		{
			target: ".fav-fab",
			title: t("tour.favs.title"),
			body: t("tour.favs.body"),
		},
		{
			target: ".locate-btn",
			title: t("tour.locate.title"),
			body: t("tour.locate.body"),
		},
	];
	const [mode, setMode] = useState<Mode>(savedSession.mode ?? "train");
	const [busOperator, setBusOperator] = useState<BusOperator>(
		savedSession.busOperator ?? "dublinbus",
	);
	const [busRoute, setBusRoute] = useState<string | null>(
		savedBusSearch.busRoute ?? null,
	);
	const [busDirection, setBusDirection] = useState<string | null>(
		savedBusSearch.busDirection ?? null,
	);
	const [trainEmptyNoticeVisible, setTrainEmptyNoticeVisible] = useState(false);
	const [trainEmptyNoticeRequest, setTrainEmptyNoticeRequest] = useState(0);
	const trainEmptyNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const trainEmptyNoticeShownRef = useRef(false);
	const trainEmptyNoticeHandledRequestRef = useRef(0);
	const showTrainEmptyNotice = useCallback(() => {
		if (trainEmptyNoticeTimerRef.current)
			clearTimeout(trainEmptyNoticeTimerRef.current);
		setTrainEmptyNoticeVisible(true);
		trainEmptyNoticeTimerRef.current = setTimeout(() => {
			setTrainEmptyNoticeVisible(false);
			trainEmptyNoticeTimerRef.current = null;
		}, 3000);
	}, []);
	const requestTrainEmptyNotice = useCallback(() => {
		setTrainEmptyNoticeRequest((n) => n + 1);
	}, []);
	const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
	const {
		trains,
		buses,
		busRealtimeHealth,
		lastUpdatedAgeSec,
		inService,
		trainsLoaded,
	} = useVehiclePolling(
		mode,
		busOperator,
		busRoute,
		busDirection,
		focusContext?.tripId ?? null,
	);
	const [busSearchTab, setBusSearchTab] = useState<BusSearchTab>(
		savedBusSearch.busSearchTab ?? "route",
	);
	const [busStopId, setBusStopId] = useState<string | null>(
		savedBusSearch.busStopId ?? null,
	);
	const [busStopOperator, setBusStopOperator] = useState<BusOperator | null>(
		savedBusSearch.busStopOperator ?? null,
	);
	const [busStopSummary, setBusStopSummary] = useState<BusStopSummary | null>(
		null,
	);
	const [trainFocusSummary, setTrainFocusSummary] =
		useState<TrainFocusSummary | null>(null);
	const lastUpdated =
		lastUpdatedAgeSec === null
			? t("info.updated.empty")
			: t("info.updated", {
					time:
						lastUpdatedAgeSec <= 1
							? t("info.updated.justnow")
							: t("info.updated.seconds", { n: lastUpdatedAgeSec }),
				});
	const [arrivalFocusResetSignal, setArrivalFocusResetSignal] = useState(0);
	const [arrivalFocusStatus, setArrivalFocusStatus] = useState<
		"idle" | "pending" | "ok" | "unavailable"
	>("idle");
	const [panelCollapsed, setPanelCollapsed] = useState(true);
	const [busFocusStopsAway, setBusFocusStopsAway] = useState<{
		tripId: string;
		stopsAway: number | null;
	} | null>(null);
	const [busShape, setBusShape] = useState<BusShape>(null);
	const filter: Filter = "all";
	const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
	const mapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		trackEvent("event/app/open");
		if (isStandalonePwa()) trackEvent("event/app/standalone-open");
	}, []);

	// When a stop-arrival is focused, hide every other bus from the map so the
	// user sees only their bus + the partial route to their stop. Flipping back
	// to full fleet is one click on the "All buses" button.
	const visibleBuses = focusContext
		? buses.filter((b) => b.tripId === focusContext.tripId)
		: buses;
	const busRouteSummary =
		mode === "bus" && busRoute && busDirection
			? {
					routeShortName: busRoute,
					headsign: busShape?.[busDirection]?.headsign ?? busDirection,
					operator: busOperator,
					vehicleCount: buses.length,
				}
			: null;

	const clearBusFocusState = useCallback(() => {
		setBusStopId(null);
		setBusStopOperator(null);
		setBusStopSummary(null);
		setFocusContext(null);
		setBusFocusStopsAway(null);
		setArrivalFocusResetSignal((n) => n + 1);
		setArrivalFocusStatus("idle");
	}, []);

	const clearBusArrivalFocusState = useCallback(() => {
		setFocusContext(null);
		setBusFocusStopsAway(null);
		setArrivalFocusResetSignal((n) => n + 1);
		setArrivalFocusStatus("idle");
	}, []);

	const showBusRouteOverview = useCallback(
		(route: string, direction: string, operator?: BusOperator) => {
			if (operator) setBusOperator(operator);
			setBusRoute(route);
			setBusDirection(direction);
			setBusSearchTab("route");
			clearBusFocusState();
			setPanelCollapsed(false);
		},
		[clearBusFocusState],
	);

	const {
		focusTrain,
		clearTrainFocus,
		closePopup,
		locateUser,
		getMapView,
		compassPref,
		startCompass,
		stopCompass,
	} = useVehicleMap(
		mapRef,
		trains,
		filter,
		searchCodes,
		mode,
		visibleBuses,
		busShape,
		busDirection,
		busOperator,
		busRealtimeHealth,
		{
			currentBusRoute: busRoute,
			onSelectBusRoute: (route, direction, operator) => {
				showBusRouteOverview(route, direction, operator);
			},
			onRouteJump: (route, direction, operator) => {
				showBusRouteOverview(route, direction, operator);
			},
			initialView: savedSession.mapView ?? null,
			focusContext,
			onTrainFocusSummary: setTrainFocusSummary,
			onFocusSegmentStatus: (status) => {
				setArrivalFocusStatus(status);
			},
			onBusFocusStopsAway: (stopsAway) => {
				setBusFocusStopsAway(
					focusContext ? { tripId: focusContext.tripId, stopsAway } : null,
				);
			},
		},
	);
	const [locating, setLocating] = useState(false);
	const { toast, showToast } = useToast();
	const [showAbout, setShowAbout] = useState(false);
	const [seenAbout, setSeenAbout] = useState<boolean>(() => {
		try {
			return localStorage.getItem(ABOUT_SEEN_KEY) === "1";
		} catch {
			return true;
		}
	});
	const [showTour, setShowTour] = useState<boolean>(() => {
		try {
			return localStorage.getItem(TOUR_SEEN_KEY) !== "1";
		} catch {
			return false;
		}
	});
	function closeTour() {
		setShowTour(false);
		try {
			localStorage.setItem(TOUR_SEEN_KEY, "1");
		} catch {}
	}
	function openTour() {
		setShowTour(true);
	}
	const {
		favs,
		toggleBus,
		toggleTrain,
		toggleStop,
		removeBus,
		removeTrain,
		removeStop,
	} = useFavorites();
	const [showFavs, setShowFavs] = useState(false);
	const [searchResetKey, setSearchResetKey] = useState(0);
	const favsRef = useRef(favs);
	favsRef.current = favs;
	const busOperatorRef = useRef(busOperator);
	busOperatorRef.current = busOperator;

	const busFavKey = useMemo(() => {
		if (!busRoute || !busDirection) return null;
		return {
			shortName: busRoute,
			operator: busOperator,
			direction: busDirection,
			headsign: busShape?.[busDirection]?.headsign ?? "",
		};
	}, [busDirection, busOperator, busRoute, busShape]);
	const busIsFav = busFavKey ? hasBus(favs, busFavKey) : false;
	const isStopFav = useCallback(
		(stop: { id: string; operator: BusOperator; code?: string }) =>
			hasStop(favs, {
				stopId: stop.id,
				operator: stop.operator,
				stopCode: stop.code,
			}),
		[favs],
	);
	const showFavLimitToast = useCallback(() => {
		showToast(t("toast.fav.full", { max: MAX_FAVORITES }));
	}, [showToast, t]);
	const onToggleBusFav = useCallback(() => {
		if (!busFavKey) return;
		const latestFavs = favsRef.current;
		if (!busIsFav && totalFavorites(latestFavs) >= MAX_FAVORITES) {
			showFavLimitToast();
			return;
		}
		const headsign = busFavKey.headsign || busDirection || "";
		trackEvent(
			busIsFav
				? "event/favorite/remove-bus-route"
				: "event/favorite/add-bus-route",
		);
		toggleBus({ ...busFavKey, headsign });
	}, [busDirection, busFavKey, busIsFav, showFavLimitToast, toggleBus]);
	const tryToggleTrain = useCallback(
		(f: TrainFavorite) => {
			const latestFavs = favsRef.current;
			if (
				!hasTrain(latestFavs, f) &&
				totalFavorites(latestFavs) >= MAX_FAVORITES
			) {
				showFavLimitToast();
				return;
			}
			trackEvent(
				hasTrain(latestFavs, f)
					? "event/favorite/remove-train"
					: "event/favorite/add-train",
			);
			toggleTrain(f);
		},
		[showFavLimitToast, toggleTrain],
	);
	const onToggleStopFav = useCallback(
		(stop: {
			id: string;
			name: string;
			code: string;
			operator: BusOperator;
		}) => {
			const fav: BusStopFavorite = {
				stopId: stop.id,
				operator: stop.operator,
				stopCode: stop.code,
				stopName: stop.name,
			};
			const latestFavs = favsRef.current;
			if (
				!hasStop(latestFavs, fav) &&
				totalFavorites(latestFavs) >= MAX_FAVORITES
			) {
				showFavLimitToast();
				return;
			}
			trackEvent(
				hasStop(latestFavs, fav)
					? "event/favorite/remove-bus-stop"
					: "event/favorite/add-bus-stop",
			);
			toggleStop(fav);
		},
		[showFavLimitToast, toggleStop],
	);

	function openAbout() {
		setShowAbout(true);
		if (!seenAbout) {
			setSeenAbout(true);
			try {
				localStorage.setItem(ABOUT_SEEN_KEY, "1");
			} catch {}
		}
	}

	const lastMapViewRef = useRef(savedSession.mapView ?? null);
	useEffect(() => {
		const save = () => {
			const mv = getMapView();
			if (mv) lastMapViewRef.current = mv;
			saveSession({
				mode,
				filter,
				busOperator,
				mapView: lastMapViewRef.current,
			});
		};
		const onVisibility = () => {
			if (document.hidden) save();
		};
		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("pagehide", save);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("pagehide", save);
		};
	}, [mode, filter, busOperator, getMapView]);

	useEffect(() => {
		if (!focusContext) setBusFocusStopsAway(null);
	}, [focusContext]);

	async function handleLocate() {
		if (locating) return;
		trackEvent("event/location/request");
		setLocating(true);
		try {
			await locateUser({
				onFinalAccuracy: (accuracy) => {
					if (accuracy <= LOW_LOCATION_ACCURACY_M) return;
					showToast(
						t("toast.location.lowAccuracy.title"),
						t("toast.location.lowAccuracy.body"),
						5000,
					);
				},
			});
		} catch (err) {
			// GeolocationPositionError codes: 1=denied, 2=unavailable, 3=timeout.
			// Surface each as a scannable toast with a hint the user can act on —
			// "User denied Geolocation" is the browser's spec text, not something
			// a non-technical user can translate into a fix.
			const code = (err as GeolocationPositionError)?.code;
			const next =
				code === 1
					? {
							title: t("toast.location.off.title"),
							body: t("toast.location.off.body"),
						}
					: code === 2
						? {
								title: t("toast.location.unavailable.title"),
								body: t("toast.location.unavailable.body"),
							}
						: code === 3
							? {
									title: t("toast.location.timeout.title"),
									body: t("toast.location.timeout.body"),
								}
							: { title: t("toast.location.unknown.title") };
			showToast(next.title, next.body, 5000);
		} finally {
			setLocating(false);
		}
	}

	useEffect(() => {
		if (!busRoute) {
			setBusShape(null);
			return;
		}
		let cancelled = false;
		fetch(
			`/api/bus/shape/${encodeURIComponent(busRoute)}?operator=${encodeURIComponent(busOperator)}`,
		)
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				if (!cancelled) setBusShape(data);
			})
			.catch(() => {
				if (!cancelled) setBusShape(null);
			});
		return () => {
			cancelled = true;
		};
	}, [busRoute, busOperator]);

	const handlePickBusFavorite = useCallback(
		(f: BusFavorite) => {
			setMode("bus");
			showBusRouteOverview(f.shortName, f.direction, f.operator);
		},
		[showBusRouteOverview],
	);

	const handlePickTrainFavorite = useCallback(
		(f: TrainFavorite) => {
			sessionStorage.setItem(
				"search",
				JSON.stringify({
					from: f.from,
					to: f.to,
					fromQuery: f.fromName,
					toQuery: f.toName,
				}),
			);
			setMode((current) => (current === "train" ? current : "train"));
			setSearchResetKey((k) => k + 1);
			setPanelCollapsed(false);
			requestTrainEmptyNotice();
		},
		[requestTrainEmptyNotice],
	);

	const handleCloseFavorites = useCallback(() => setShowFavs(false), []);

	const handleTrainSearch = useCallback(
		(codes: string[]) => {
			trackEvent("event/search/train");
			setSearchCodes(codes.length > 0 ? codes : []);
			setTrainFocusSummary(null);
			clearTrainFocus();
		},
		[clearTrainFocus],
	);

	const handleClearTrainSearch = useCallback(() => {
		setSearchCodes(null);
		setTrainFocusSummary(null);
		clearTrainFocus();
	}, [clearTrainFocus]);

	const handleTrainSelect = useCallback(
		async (code: string, boardingStationCode?: string) => {
			const result = await focusTrain(code, boardingStationCode);
			if (result === "focused") setSearchCodes([code]);
			return result;
		},
		[focusTrain],
	);

	const handleShowAllTrains = useCallback(() => {
		setSearchCodes(null);
		setTrainFocusSummary(null);
		clearTrainFocus();
	}, [clearTrainFocus]);

	const handlePickStopFavorite = useCallback((s: BusStopFavorite) => {
		setMode((current) => (current === "bus" ? current : "bus"));
		setBusRoute(null);
		setBusDirection(null);
		setFocusContext(null);
		setArrivalFocusStatus("idle");
		setBusSearchTab("stop");
		setBusStopId(s.stopId);
		setBusStopOperator(s.operator);
		setPanelCollapsed(false);
	}, []);

	const handleSelectBusRoute = useCallback(
		(r: string | null, op?: BusOperator) => {
			if (r !== null) trackEvent("event/search/bus-route");
			if (op && op !== busOperatorRef.current) {
				setBusOperator(op);
			}
			setBusRoute(r);
			setBusDirection(null);
			setBusSearchTab("route");
			clearBusFocusState();
			if (r !== null) {
				setPanelCollapsed(false);
			}
		},
		[clearBusFocusState],
	);

	const handleSelectBusDirection = useCallback(
		(direction: string | null) => {
			if (direction && busRoute) {
				showBusRouteOverview(busRoute, direction);
			} else {
				setBusDirection(direction);
			}
		},
		[busRoute, showBusRouteOverview],
	);

	const handlePanelCollapsedChange = useCallback(
		(collapsed: boolean) => {
			if (!collapsed) closePopup();
			setPanelCollapsed(collapsed);
		},
		[closePopup],
	);

	const handleBusTabChange = useCallback((tab: BusSearchTab) => {
		setBusSearchTab(tab);
		if (tab === "route") {
			setFocusContext(null);
			setArrivalFocusResetSignal((n) => n + 1);
			setArrivalFocusStatus("idle");
		}
	}, []);

	const handleStopIdChange = useCallback(
		(id: string | null, op: BusOperator | null) => {
			if (id !== null) trackEvent("event/search/bus-stop");
			setBusStopId(id);
			setBusStopOperator(op);
			setArrivalFocusStatus("idle");
		},
		[],
	);

	const handlePickArrival = useCallback(
		(
			arrival: Parameters<
				React.ComponentProps<typeof BusSearchPanel>["onPickArrival"]
			>[0],
			op: BusOperator,
			stop: Parameters<
				React.ComponentProps<typeof BusSearchPanel>["onPickArrival"]
			>[2],
		) => {
			// Clear any selected route so the user lands in all-buses mode; the
			// full vehicle response already includes the target trip for focusing.
			setBusRoute(null);
			setBusDirection(null);
			setArrivalFocusStatus("pending");
			setBusFocusStopsAway({
				tripId: arrival.tripId,
				stopsAway: arrival.stopsAway,
			});
			setFocusContext({
				tripId: arrival.tripId,
				operator: op,
				routeShortName: arrival.routeShortName,
				direction: arrival.direction,
				targetStopId: stop.id,
				targetStopCode: stop.code,
				targetStopName: stop.name,
				targetStopLat: stop.lat,
				targetStopLng: stop.lng,
				targetStopSequence: arrival.stopSequence,
				vehicleStopSequence:
					arrival.stopsAway === null
						? null
						: arrival.stopSequence - arrival.stopsAway,
			});
		},
		[],
	);

	const handleStopSummaryChange = useCallback(
		(summary: BusStopSummary | null) => {
			setBusStopSummary(summary);
			if (summary) setBusSearchTab("stop");
		},
		[],
	);

	const handleModeChange = useCallback(
		(m: Mode) => {
			trackEvent(m === "bus" ? "event/mode/bus" : "event/mode/train");
			setMode(m);
			setSearchCodes(null);
			clearTrainFocus();
			setBusRoute(null);
			setBusDirection(null);
			setBusStopId(null);
			setBusStopOperator(null);
			setBusStopSummary(null);
			setBusSearchTab(m === "bus" ? "stop" : "route");
			setFocusContext(null);
			setArrivalFocusStatus("idle");
			setPanelCollapsed(true);
			clearBusSearchSession();
			// SearchPanel rehydrates from/to queries from this sessionStorage key
			// on mount, so App-state clearing alone isn't enough — clear the
			// persisted copy too or remounting restores the train search.
			try {
				sessionStorage.removeItem("search");
			} catch {}
		},
		[clearTrainFocus],
	);

	const showNoTrainPositions = mode === "train" && trainEmptyNoticeVisible;
	const showTrainEmptyNoticeIfUnavailable = useCallback(() => {
		requestTrainEmptyNotice();
	}, [requestTrainEmptyNotice]);

	useEffect(() => {
		const unavailable =
			mode === "train" && inService && trainsLoaded && trains.length === 0;
		if (!unavailable) {
			trainEmptyNoticeShownRef.current = false;
			trainEmptyNoticeHandledRequestRef.current = trainEmptyNoticeRequest;
			if (mode !== "train" || !inService || trains.length > 0)
				setTrainEmptyNoticeVisible(false);
			return;
		}

		const hasNewRequest =
			trainEmptyNoticeRequest !== trainEmptyNoticeHandledRequestRef.current;
		if (!trainEmptyNoticeShownRef.current || hasNewRequest) {
			trainEmptyNoticeShownRef.current = true;
			trainEmptyNoticeHandledRequestRef.current = trainEmptyNoticeRequest;
			showTrainEmptyNotice();
		}
	}, [
		inService,
		mode,
		showTrainEmptyNotice,
		trainEmptyNoticeRequest,
		trains.length,
		trainsLoaded,
	]);

	useEffect(
		() => () => {
			if (trainEmptyNoticeTimerRef.current)
				clearTimeout(trainEmptyNoticeTimerRef.current);
		},
		[],
	);

	return (
		<>
			<div id="map" ref={mapRef} />
			{showNoTrainPositions && (
				<div className="map-empty-state" role="status" aria-live="polite">
					<div className="map-empty-state__title">
						{t("map.empty.trains.title")}
					</div>
					<div className="map-empty-state__body">
						{t("map.empty.trains.body")}
					</div>
				</div>
			)}
			<OfflineBanner />
			{mode === "bus" && <RealtimeBanner health={busRealtimeHealth} />}
			{toast && (
				<div className="app-toast" role="alert">
					<div className="app-toast__text">
						<div className="app-toast__title">{toast.title}</div>
						{toast.body && <div className="app-toast__body">{toast.body}</div>}
					</div>
				</div>
			)}
			<button
				type="button"
				className={`fab locate-btn${locating ? " loading" : ""}`}
				onClick={handleLocate}
				disabled={locating}
				aria-label={t("fab.locate.aria")}
				title={t("fab.locate.aria")}
			>
				<svg
					viewBox="0 0 24 24"
					width="20"
					height="20"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<circle cx="12" cy="12" r="3" />
					<path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
				</svg>
			</button>
			<button
				type="button"
				className="fab fav-fab"
				onClick={() => setShowFavs(true)}
				aria-label={t("fab.favs.aria")}
				title={t("fab.favs.aria")}
			>
				<svg
					viewBox="0 0 24 24"
					width="20"
					height="20"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.75"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1L3.2 9.4l6.1-.9z" />
				</svg>
			</button>
			<button
				type="button"
				className="fab about-fab"
				onClick={openAbout}
				aria-label={t("fab.about.aria")}
				title={t("fab.about.aria")}
			>
				<PucaMark size={28} />
				{!seenAbout && <span className="about-fab__badge" aria-hidden="true" />}
			</button>
			{showAbout && (
				<AboutModal
					onClose={() => setShowAbout(false)}
					onShowTour={() => {
						setShowAbout(false);
						openTour();
					}}
					compassPref={compassPref}
					onToggleCompass={
						needsCompassToggle
							? (next) => {
									if (next) void startCompass();
									else stopCompass();
								}
							: undefined
					}
				/>
			)}
			{showTour && <OnboardingTour steps={tourSteps} onClose={closeTour} />}
			{showFavs && (
				<FavoritesModal
					onClose={handleCloseFavorites}
					favs={favs}
					onPickBus={handlePickBusFavorite}
					onPickTrain={handlePickTrainFavorite}
					onPickStop={handlePickStopFavorite}
					onRemoveBus={removeBus}
					onRemoveTrain={removeTrain}
					onRemoveStop={removeStop}
				/>
			)}
			{mode === "train" ? (
				<SearchPanel
					key={searchResetKey}
					onSearch={handleTrainSearch}
					onClear={handleClearTrainSearch}
					onTrainSelect={handleTrainSelect}
					favs={favs}
					onToggleTrain={tryToggleTrain}
					collapsed={panelCollapsed}
					onCollapsedChange={handlePanelCollapsedChange}
					onShowToast={showToast}
					onSearchIntent={showTrainEmptyNoticeIfUnavailable}
				/>
			) : (
				<BusSearchPanel
					onSelectRoute={handleSelectBusRoute}
					selectedRoute={busRoute}
					onSelectDirection={handleSelectBusDirection}
					selectedDirection={busDirection}
					busShape={busShape}
					isFavorite={busIsFav}
					onToggleFavorite={onToggleBusFav}
					busSearchTab={busSearchTab}
					onTabChange={handleBusTabChange}
					busStopId={busStopId}
					busStopOperator={busStopOperator}
					onStopIdChange={handleStopIdChange}
					collapsed={panelCollapsed}
					onCollapsedChange={handlePanelCollapsedChange}
					onShowToast={showToast}
					isStopFavorite={isStopFav}
					onToggleStopFavorite={onToggleStopFav}
					onStopSummaryChange={handleStopSummaryChange}
					focusedStopsAwayOverride={busFocusStopsAway}
					arrivalFocusResetSignal={arrivalFocusResetSignal}
					arrivalFocusStatus={arrivalFocusStatus}
					onPickArrival={handlePickArrival}
				/>
			)}
			{mode === "bus" && (busRoute !== null || focusContext !== null) && (
				<button
					type="button"
					className="back-to-all-btn"
					onClick={() => {
						setBusRoute(null);
						setBusDirection(null);
						clearBusArrivalFocusState();
					}}
				>
					&larr; {t("bus.back.all")}
				</button>
			)}
			{mode === "train" && searchCodes !== null && (
				<button
					type="button"
					className="back-to-all-btn"
					onClick={handleShowAllTrains}
				>
					&larr; {t("train.back.all")}
				</button>
			)}
			<InfoPanel
				lastUpdated={lastUpdated}
				mode={mode}
				inService={inService}
				onModeChange={handleModeChange}
				busSearchTab={busSearchTab}
				busRouteSummary={busRouteSummary}
				busStopSummary={busStopSummary}
				trainFocusSummary={trainFocusSummary}
			/>
		</>
	);
}

// biome-ignore lint/style/noNonNullAssertion: root always exists in index.html
const root = createRoot(document.getElementById("root")!);
root.render(
	<ErrorBoundary>
		<App />
	</ErrorBoundary>,
);

registerServiceWorker();
