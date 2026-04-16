const NTA_GTFSR_URL = "https://api.nationaltransport.ie/gtfsr/v2/gtfsr?format=json";

export interface GtfsVehiclePosition {
  tripId: string;
  routeId: string;
  lat: number;
  lng: number;
  bearing: number | null;
  speed: number | null; // m/s
  timestamp: number;
  label: string;
}

interface GtfsEntity {
  vehicle?: {
    trip?: { trip_id?: string; route_id?: string };
    position?: {
      latitude?: number;
      longitude?: number;
      bearing?: number;
      speed?: number;
    };
    vehicle?: { id?: string; label?: string };
    timestamp?: number | string;
  };
}

export async function getGtfsrVehiclePositions(): Promise<GtfsVehiclePosition[]> {
  const apiKey = process.env.NTA_API_KEY;
  if (!apiKey || apiKey === "your_api_key_here") {
    console.warn("NTA_API_KEY not set — GTFS-R disabled");
    return [];
  }

  try {
    const res = await fetch(NTA_GTFSR_URL, {
      headers: {
        "x-api-key": apiKey,
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) throw new Error(`GTFS-R HTTP ${res.status}`);

    const data = await res.json();
    const entities: GtfsEntity[] = data.entity ?? [];
    const vehicles: GtfsVehiclePosition[] = [];

    for (const entity of entities) {
      const vp = entity.vehicle;
      if (!vp?.position?.latitude || !vp?.position?.longitude) continue;

      vehicles.push({
        tripId: vp.trip?.trip_id ?? "",
        routeId: vp.trip?.route_id ?? "",
        lat: vp.position.latitude,
        lng: vp.position.longitude,
        bearing: vp.position.bearing ?? null,
        speed: vp.position.speed ?? null,
        timestamp: Number(vp.timestamp ?? 0),
        label: vp.vehicle?.label ?? vp.vehicle?.id ?? "",
      });
    }

    return vehicles;
  } catch (err) {
    console.error("GTFS-R fetch error:", err);
    return [];
  }
}
