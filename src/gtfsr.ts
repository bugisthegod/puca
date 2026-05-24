import {
	type BusStopArrival,
	decideStopArrival,
	type StopArrivalDecision,
} from "./gtfsr/arrivals";
import {
	type GtfsrHealthSnapshot,
	getBusTripUpdateRealtimeHeaders,
	getBusTripUpdateRealtimeHealth,
	getBusVehicleRealtimeHeaders,
	getBusVehicleRealtimeHealth,
	getGtfsrHealthSnapshot,
	startBackgroundPolling,
} from "./gtfsr/realtimeOrchestration";
import {
	__testing,
	getAllBusVehicles,
	getAllOperatorsBusVehicles,
	getBusStopArrivals,
	getBusTripStops,
	getBusVehiclesByRoute,
	getGtfsrVehiclePositions,
} from "./gtfsr/realtimeReaders";
import {
	type BusRouteDirectionShape,
	getBusRouteShape,
	getBusRoutes,
	getOperatorStop,
	type ScheduledRow,
	type StopSearchResult,
	searchAllBusStops,
	searchBusStops,
} from "./gtfsr/schedules";
import type { LiveTripData } from "./gtfsr/timing";
import { getAllTrainShapes, getTrainRouteShape } from "./gtfsr/trainShapes";
import {
	mergeTripStops,
	type StopTimeUpdate,
	type TripUpdate,
} from "./gtfsr/trips";
import type { GtfsVehiclePosition } from "./gtfsr/vehicles";
import type { VehicleBounds } from "./types";

export type { BusOperator as Operator, BusRoute, BusVehicle } from "./types";
export type {
	BusRouteDirectionShape,
	BusStopArrival,
	GtfsrHealthSnapshot,
	GtfsVehiclePosition,
	LiveTripData,
	ScheduledRow,
	StopArrivalDecision,
	StopSearchResult,
	StopTimeUpdate,
	TripUpdate,
	VehicleBounds,
};
export {
	__testing,
	decideStopArrival,
	getAllBusVehicles,
	getAllOperatorsBusVehicles,
	getAllTrainShapes,
	getBusRouteShape,
	getBusRoutes,
	getBusStopArrivals,
	getBusTripStops,
	getBusTripUpdateRealtimeHeaders,
	getBusTripUpdateRealtimeHealth,
	getBusVehicleRealtimeHeaders,
	getBusVehicleRealtimeHealth,
	getBusVehiclesByRoute,
	getGtfsrHealthSnapshot,
	getGtfsrVehiclePositions,
	getOperatorStop,
	getTrainRouteShape,
	mergeTripStops,
	searchAllBusStops,
	searchBusStops,
	startBackgroundPolling,
};
