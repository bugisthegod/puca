import { XMLParser } from "fast-xml-parser";
import type { Train, Station, StationTrain, TrainMovement } from "./types.ts";
import stationsData from "./data/stations.json" with { type: "json" };

const BASE_URL = "https://api.irishrail.ie/realtime/realtime.asmx";

// --- Cache layer ---
const cache = new Map<string, { data: unknown; expires: number }>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) return Promise.resolve(entry.data as T);
  return fn().then((data) => {
    cache.set(key, { data, expires: Date.now() + ttlMs });
    return data;
  });
}

const parser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  parseTagValue: true,
});

function todayFormatted(): string {
  const d = new Date();
  const day = d.getDate();
  const month = d.toLocaleString("en-IE", { month: "short" }).toLowerCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function normalizeArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function getCurrentTrains(): Promise<Train[]> {
  return cached("currentTrains", 15_000, async () => {
    try {
      const res = await fetch(`${BASE_URL}/getCurrentTrainsXML`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const raw = parsed?.ArrayOfObjTrainPositions?.objTrainPositions;
      const items = normalizeArray(raw);
      return items.map((item: Record<string, unknown>) => ({
        code: String(item.TrainCode ?? ""),
        lat: Number(item.TrainLatitude ?? 0),
        lng: Number(item.TrainLongitude ?? 0),
        status: (String(item.TrainStatus ?? "N")) as Train["status"],
        message: String(item.PublicMessage ?? ""),
        direction: String(item.Direction ?? ""),
        date: String(item.TrainDate ?? ""),
      }));
    } catch (err) {
      console.error("getCurrentTrains error:", err);
      return [];
    }
  });
}

export function getStationData(
  stationCode: string,
  numMins: number = 90
): Promise<StationTrain[]> {
  return cached(`station:${stationCode}:${numMins}`, 30_000, async () => {
    try {
      const url = `${BASE_URL}/getStationDataByCodeXML_WithNumMins?StationCode=${encodeURIComponent(stationCode)}&NumMins=${numMins}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const raw = parsed?.ArrayOfObjStationData?.objStationData;
      const items = normalizeArray(raw);
      return items.map((item: Record<string, unknown>) => ({
        trainCode: String(item.Traincode ?? "").trim(),
        stationName: String(item.Stationfullname ?? ""),
        stationCode: String(item.Stationcode ?? ""),
        origin: String(item.Origin ?? ""),
        destination: String(item.Destination ?? ""),
        originTime: String(item.Origintime ?? ""),
        destinationTime: String(item.Destinationtime ?? ""),
        status: String(item.Status ?? ""),
        lastLocation: String(item.Lastlocation ?? ""),
        dueIn: Number(item.Duein ?? 0),
        late: Number(item.Late ?? 0),
        expArrival: String(item.Exparrival ?? ""),
        expDepart: String(item.Expdepart ?? ""),
        schArrival: String(item.Scharrival ?? ""),
        schDepart: String(item.Schdepart ?? ""),
        direction: String(item.Direction ?? ""),
        trainType: String(item.Traintype ?? ""),
      }));
    } catch (err) {
      console.error("getStationData error:", err);
      return [];
    }
  });
}

export function getTrainMovements(
  trainId: string,
  trainDate: string = todayFormatted()
): Promise<TrainMovement[]> {
  return cached(`movements:${trainId}:${trainDate}`, 30_000, async () => {
    try {
      const url = `${BASE_URL}/getTrainMovementsXML?TrainId=${encodeURIComponent(trainId)}&TrainDate=${encodeURIComponent(trainDate)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const parsed = parser.parse(xml);
      const raw = parsed?.ArrayOfObjTrainMovements?.objTrainMovements;
      const items = normalizeArray(raw);
      return items.map((item: Record<string, unknown>) => ({
        trainCode: String(item.TrainCode ?? ""),
        stationName: String(item.LocationFullName ?? ""),
        stationCode: String(item.LocationCode ?? ""),
        scheduledArrival: String(item.ScheduledArrival ?? ""),
        scheduledDepart: String(item.ScheduledDeparture ?? ""),
        expectedArrival: String(item.ExpectedArrival ?? ""),
        expectedDepart: String(item.ExpectedDeparture ?? ""),
        arrival: String(item.Arrival ?? ""),
        departure: String(item.Departure ?? ""),
        stopType: String(item.StopType ?? ""),
      }));
    } catch (err) {
      console.error("getTrainMovements error:", err);
      return [];
    }
  });
}

export function getAllStations(): Promise<Station[]> {
  return Promise.resolve(stationsData as Station[]);
}
