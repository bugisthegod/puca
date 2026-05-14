import L from "leaflet";
import "leaflet.markercluster";
(window as unknown as { L: typeof L }).L = L;

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
import type { BusOperator, FocusContext, TrainFocusSummary } from "./types";
import { type Filter, SERVICE_RESUME_LABEL } from "./utils";
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
	const { locale, t } = useLocale();
	const tourSteps: TourStep[] = useMemo(
		() => [
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
			// eslint-disable-next-line react-hooks/exhaustive-deps
		],
		[locale],
	);
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
	const { trains, buses, setBuses, lastUpdated, inService, trainsLoaded } =
		useVehiclePolling(mode, busOperator, busRoute, busDirection);
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
	const [infoPanelDrilledIn, setInfoPanelDrilledIn] = useState(false);
	const [arrivalFocusResetSignal, setArrivalFocusResetSignal] = useState(0);
	const [arrivalFocusUnavailable, setArrivalFocusUnavailable] = useState(false);
	const [panelCollapsed, setPanelCollapsed] = useState(true);
	const [focusContext, setFocusContext] = useState<FocusContext | null>(null);
	const [busShape, setBusShape] = useState<{
		[dir: string]: {
			headsign: string;
			coords: [number, number][];
			stops: { id: string; name: string; lat: number; lng: number }[];
			variants?: {
				shapeId: string;
				tripCount: number;
				branches: [number, number][][];
			}[];
		};
	} | null>(null);
	const [filter, setFilter] = useState<Filter>(savedSession.filter ?? "all");
	const [searchCodes, setSearchCodes] = useState<string[] | null>(null);
	const mapRef = useRef<HTMLDivElement>(null);

	// When a stop-arrival is focused, hide every other bus from the map so the
	// user sees only their bus + the partial route to their stop. Flipping back
	// to full fleet is one click on the "All buses" button.
	const visibleBuses = focusContext
		? buses.filter((b) => b.tripId === focusContext.tripId)
		: buses;

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
		{
			currentBusRoute: busRoute,
			onSelectBusRoute: (route, direction) => {
				setBusRoute(route);
				setBusDirection(direction);
				setFocusContext(null);
				setArrivalFocusUnavailable(false);
			},
			onRouteJump: (route, direction) => {
				setBusRoute(route);
				setBusDirection(direction);
				setFocusContext(null);
				setArrivalFocusUnavailable(false);
				if (
					!hasBus(favs, { shortName: route, operator: busOperator, direction })
				) {
					setPanelCollapsed(false);
				}
			},
			initialView: savedSession.mapView ?? null,
			focusContext,
			onFocusSegmentStatus: (status) => {
				setArrivalFocusUnavailable(status === "unavailable");
			},
			onTrainFocusSummary: (summary) => {
				setTrainFocusSummary(summary);
				if (summary) setInfoPanelDrilledIn(true);
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

	const busFavKey = useMemo(
		() =>
			busRoute && busDirection
				? {
						shortName: busRoute,
						operator: busOperator,
						direction: busDirection,
					}
				: null,
		[busDirection, busOperator, busRoute],
	);
	const busIsFav = busFavKey ? hasBus(favs, busFavKey) : false;
	const stopIsFav =
		busStopId && busStopOperator
			? hasStop(favs, { stopId: busStopId, operator: busStopOperator })
			: false;
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
		const headsign =
			busShape?.[busDirection ?? ""]?.headsign ?? busDirection ?? "";
		toggleBus({ ...busFavKey, headsign });
	}, [
		busDirection,
		busFavKey,
		busIsFav,
		busShape,
		showFavLimitToast,
		toggleBus,
	]);
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

	async function handleLocate() {
		if (locating) return;
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

	const handleBusOperatorChange = useCallback((op: BusOperator) => {
		if (op === busOperatorRef.current) return;
		setBusOperator(op);
		setBusRoute(null);
		setBusDirection(null);
		setBusStopId(null);
		setBusStopOperator(null);
		setBuses([]);
		setFocusContext(null);
		setArrivalFocusUnavailable(false);
		setPanelCollapsed(true);
	}, []);

	const handlePickBusFavorite = useCallback((f: BusFavorite) => {
		setMode("bus");
		setBusOperator(f.operator);
		setBusRoute(f.shortName);
		setBusDirection(f.direction);
		setBuses([]);
		// Symmetric to onPickStop: clear any stop selection + focus so the
		// panel doesn't stay stuck on the stop tab while the map shows the
		// route.
		setBusSearchTab("route");
		setBusStopId(null);
		setFocusContext(null);
		setArrivalFocusUnavailable(false);
		setPanelCollapsed(true);
	}, []);

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
			setSearchCodes(codes.length > 0 ? codes : []);
			clearTrainFocus();
		},
		[clearTrainFocus],
	);

	const handleClearTrainSearch = useCallback(() => {
		setSearchCodes(null);
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
		clearTrainFocus();
	}, [clearTrainFocus]);

	const handlePickStopFavorite = useCallback((s: BusStopFavorite) => {
		setMode((current) => (current === "bus" ? current : "bus"));
		if (s.operator !== busOperatorRef.current) {
			setBusOperator(s.operator);
			setBuses([]);
		}
		setBusRoute(null);
		setBusDirection(null);
		setFocusContext(null);
		setArrivalFocusUnavailable(false);
		setBusSearchTab("stop");
		setBusStopId(s.stopId);
		setBusStopOperator(s.operator);
		setPanelCollapsed(false);
	}, []);

	const handleSelectBusRoute = useCallback(
		(r: string | null, op?: BusOperator) => {
			if (op && op !== busOperatorRef.current) {
				setBusOperator(op);
				setBuses([]);
			}
			setBusRoute(r);
			setBusDirection(null);
		},
		[],
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
			setInfoPanelDrilledIn(false);
			setArrivalFocusUnavailable(false);
		}
	}, []);

	const handleStopIdChange = useCallback(
		(id: string | null, op: BusOperator | null) => {
			setBusStopId(id);
			setBusStopOperator(op);
			setArrivalFocusUnavailable(false);
			// Picking a stop in an operator different from the current route-mode
			// default would otherwise leave the all-fleet browse pinned to the old
			// operator — sync it so a tab back to route mode shows buses near the
			// chosen stop.
			if (op && op !== busOperatorRef.current) {
				setBusOperator(op);
				setBuses([]);
			}
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
			// Clear any selected route so the user lands in all-buses mode — the
			// target tripId is included in fetchAllBuses, so the focus effect can
			// find the marker without drawing the whole polyline.
			setBusRoute(null);
			setBusDirection(null);
			setInfoPanelDrilledIn(true);
			setArrivalFocusUnavailable(false);
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
			});
		},
		[],
	);

	const handleModeChange = useCallback(
		(m: Mode) => {
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
			setArrivalFocusUnavailable(false);
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

	const vehicleCount =
		mode === "train"
			? trains.filter((t) => t.status === "R").length
			: buses.length;
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
					onSelectDirection={setBusDirection}
					selectedDirection={busDirection}
					busShape={busShape}
					isFavorite={busIsFav}
					onToggleFavorite={onToggleBusFav}
					busOperator={busOperator}
					busSearchTab={busSearchTab}
					onTabChange={handleBusTabChange}
					busStopId={busStopId}
					busStopOperator={busStopOperator}
					onStopIdChange={handleStopIdChange}
					collapsed={panelCollapsed}
					onCollapsedChange={handlePanelCollapsedChange}
					onShowToast={showToast}
					stopIsFavorite={stopIsFav}
					onToggleStopFavorite={onToggleStopFav}
					onStopSummaryChange={setBusStopSummary}
					arrivalFocusResetSignal={arrivalFocusResetSignal}
					arrivalFocusUnavailable={arrivalFocusUnavailable}
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
						setFocusContext(null);
						setArrivalFocusResetSignal((n) => n + 1);
						setInfoPanelDrilledIn(false);
						setArrivalFocusUnavailable(false);
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
				vehicleCount={vehicleCount}
				lastUpdated={
					lastUpdated
						? t("info.updated", { time: lastUpdated })
						: t("info.updated.empty")
				}
				mode={mode}
				busSearchTab={busSearchTab}
				filter={filter}
				inService={inService}
				resumeLabel={SERVICE_RESUME_LABEL}
				busOperator={busOperator}
				busStopSummary={busStopSummary}
				trainFocusSummary={trainFocusSummary}
				drilledIn={infoPanelDrilledIn}
				onDrilledInChange={(next) => {
					setInfoPanelDrilledIn(next);
					if (!next && mode === "train") clearTrainFocus();
				}}
				onModeChange={handleModeChange}
				onFilterChange={setFilter}
				onBusOperatorChange={handleBusOperatorChange}
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
