export type Train = {
	code: string;
	lat: number;
	lng: number;
	status: "R" | "N" | "T"; // Running, Not yet running, Terminated
	message: string;
	direction: string;
	date: string;
};

export type StationTrain = {
	trainCode: string;
	stationName: string;
	stationCode: string;
	origin: string;
	destination: string;
	originTime: string;
	destinationTime: string;
	status: string;
	lastLocation: string;
	dueIn: number;
	late: number;
	expArrival: string;
	expDepart: string;
	schArrival: string;
	schDepart: string;
	direction: string;
	trainType: string;
};

export type Station = {
	name: string;
	code: string;
	lat: number;
	lng: number;
};

export type SearchResult = {
	code: string;
	origin: string;
	destination: string;
	fromDep: string;
	toArr: string;
	status: "running" | "ready" | "unmapped" | "scheduled"; // running/ready=可聚焦, unmapped=在跑但暂无有效坐标
};

export type TrainFocusSummary = {
	trainCode: string;
	directionName: string | null;
	stopsAway: number | null;
	etaMinutes: number | null;
};

export type BusOperator = "dublinbus" | "buseireann" | "goahead";

export type BusRoute = {
	id: string;
	shortName: string;
	longName: string;
};

export type BusStop = {
	id: string;
	name: string;
	lat: number;
	lng: number;
};

export type FocusContext = {
	tripId: string;
	operator: BusOperator;
	routeShortName: string;
	direction: string;
	targetStopId: string;
	targetStopCode: string;
	targetStopName: string;
	targetStopLat: number;
	targetStopLng: number;
};

export type BusVehicle = {
	tripId: string;
	routeId: string;
	routeShortName: string;
	lat: number;
	lng: number;
	bearing: number | null;
	speed: number | null;
	timestamp: number;
	label: string;
	directionId: number;
	shapeId: string | null;
	stale: boolean;
};

export type TrainMovement = {
	trainCode: string;
	stationName: string;
	stationCode: string;
	scheduledArrival: string;
	scheduledDepart: string;
	expectedArrival: string;
	expectedDepart: string;
	arrival: string;
	departure: string;
	stopType: string; // C=Current, O=Origin, S=Stop, T=Terminus, D=Destination
};
