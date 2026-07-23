type PropertyPoint = {
  address: string;
  lat: number;
  lng: number;
};

type LegDetail = {
  mode: string;
  durationMinutes: number;
  lineName: string;
  fromStation: string | null;
  toStation: string | null;
  fromStationCoords?: [number, number] | null;
  toStationCoords?: [number, number] | null;
};

type JourneyResult = {
  totalMinutes: number;
  legs: LegDetail[];
  unreachable?: boolean;
  unreachableReason?: string;
  isEstimate?: boolean;
  estimateNote?: string;
  estimatedTaxiNote?: string;
  pathCoordinates?: [number, number][];
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function haversineWalkingMinutes(from: PropertyPoint, to: PropertyPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  const distanceMeters = R * c;
  const AVERAGE_WALKING_SPEED_MPS = 1.3;
  return distanceMeters / AVERAGE_WALKING_SPEED_MPS / 60;
}

async function getWalkingJourney(
  from: PropertyPoint,
  to: PropertyPoint
): Promise<JourneyResult> {
  await sleep(600);
  const url = `https://us1.locationiq.com/v1/directions/walking/${from.lng},${from.lat};${to.lng},${to.lat}?key=${process.env.LOCATIONIQ_ACCESS_TOKEN}&overview=full&geometries=geojson`;
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `LocationIQ walking request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`
    );
  }

  const data = await res.json();
  const route = data.routes?.[0];

  if (!route) {
    throw new Error(`No walking route found between "${from.address}" and "${to.address}"`);
  }

  const minutes = route.duration / 60;
  const coordinates: [number, number][] =
    route.geometry?.coordinates?.map((coordinate: [number, number]) => [
      coordinate[1],
      coordinate[0],
    ]) || [];

  return {
    totalMinutes: minutes,
    legs: [
      {
        mode: "walking",
        durationMinutes: Math.round(minutes),
        lineName: "walking route",
        fromStation: null,
        toStation: null,
      },
    ],
    pathCoordinates: coordinates,
  };
}

async function getCarJourney(
  from: PropertyPoint,
  to: PropertyPoint,
  departAt: string
): Promise<JourneyResult> {
  await sleep(300);

  const routeUrl = `https://api.tomtom.com/routing/1/calculateRoute/${from.lat},${from.lng}:${to.lat},${to.lng}/json?key=${process.env.TOMTOM_API_KEY}&traffic=true&departAt=${encodeURIComponent(departAt)}`;
  const res = await fetch(routeUrl);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `TomTom request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`
    );
  }

  const data = await res.json();
  const route = data.routes?.[0];

  if (!route || route.summary?.travelTimeInSeconds == null) {
    throw new Error(`No driving route found between "${from.address}" and "${to.address}"`);
  }

  const seconds = route.summary.travelTimeInSeconds;
  const pathCoordinates: [number, number][] = (route.legs || []).flatMap(
    (leg: any) =>
      (leg.points || []).map(
        (point: { latitude: number; longitude: number }) =>
          [point.latitude, point.longitude] as [number, number]
      )
  );

  return {
    totalMinutes: seconds / 60,
    legs: [
      {
        mode: "car",
        durationMinutes: Math.round(seconds / 60),
        lineName: "driving",
        fromStation: null,
        toStation: null,
      },
    ],
    pathCoordinates,
  };
}

function modeParamFor(travelMode: string): string {
  if (travelMode === "cycling") return "cycle";
  return "bus,tube,dlr,overground,elizabeth-line,national-rail,tram,walking";
}

export async function getJourney(
  from: PropertyPoint,
  to: PropertyPoint,
  travelMode: string,
  departAt?: string
): Promise<JourneyResult> {
  if (travelMode === "walking") {
    return getWalkingJourney(from, to);
  }

  if (travelMode === "car" || travelMode === "taxi") {
    const carResult = await getCarJourney(
      from,
      to,
      departAt || new Date().toISOString()
    );
    if (travelMode === "taxi") {
      const pickupWaitMinutes = 5;
      return {
        totalMinutes: carResult.totalMinutes + pickupWaitMinutes,
        legs: [
          {
            mode: "taxi",
            durationMinutes: Math.round(carResult.totalMinutes),
            lineName: "driving",
            fromStation: null,
            toStation: null,
          },
        ],
        estimatedTaxiNote: `Includes an estimated ${pickupWaitMinutes} min pickup wait - not based on live driver availability or pricing.`,
        pathCoordinates: carResult.pathCoordinates,
      };
    }
    return carResult;
  }

  const mode = modeParamFor(travelMode);

  let dateTimeParams = "";
  if (departAt) {
    const d = new Date(departAt);
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
      d.getDate()
    ).padStart(2, "0")}`;
    const time = `${String(d.getHours()).padStart(2, "0")}${String(
      d.getMinutes()
    ).padStart(2, "0")}`;
    dateTimeParams = `&date=${date}&time=${time}&timeIs=Departing`;
  }

  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?mode=${mode}${dateTimeParams}&app_key=${process.env.TFL_API_KEY}`;
  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `TfL journey request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`
    );
  }

  const data = await res.json();

  const fastestPreview = data.journeys?.[0];
  console.log(
    `TfL summary for ${from.address} -> ${to.address}: duration=${fastestPreview?.duration}, legs=${fastestPreview?.legs?.map((leg: any) => `${leg.mode?.name}:${leg.duration}min`).join(", ")}`
  );

  if (!data.journeys || data.journeys.length === 0) {
    throw new Error(
      `No journey found between "${from.address}" and "${to.address}" for mode "${travelMode}"`
    );
  }

  const fastest = data.journeys.reduce((min: any, j: any) =>
    j.duration < min.duration ? j : min
  );

  const legs: LegDetail[] = (fastest.legs || []).map((leg: any) => {
    const lineName =
      leg.routeOptions?.[0]?.name ||
      leg.instruction?.detailed ||
      leg.mode?.name ||
      "unknown";
    const formatStopName = (point: any): string | null => {
      if (!point?.commonName) return null;
      const letter = point.stopLetter;
      return letter ? `${point.commonName} (Stop ${letter})` : point.commonName;
    };

    const fromStation = formatStopName(leg.departurePoint);
    const toStation = formatStopName(leg.arrivalPoint);
    const fromStationCoords =
      typeof leg.departurePoint?.lat === "number" &&
      typeof leg.departurePoint?.lon === "number"
        ? ([leg.departurePoint.lat, leg.departurePoint.lon] as [
            number,
            number,
          ])
        : null;
    const toStationCoords =
      typeof leg.arrivalPoint?.lat === "number" &&
      typeof leg.arrivalPoint?.lon === "number"
        ? ([leg.arrivalPoint.lat, leg.arrivalPoint.lon] as [number, number])
        : null;

    return {
      mode: leg.mode?.name || "unknown",
      durationMinutes: leg.duration ?? 0,
      lineName,
      fromStation,
      toStation,
      fromStationCoords,
      toStationCoords,
    };
  });

  const pathCoordinates: [number, number][] = [];
  for (const leg of fastest.legs || []) {
    const lineStringRaw = leg.path?.lineString;
    if (lineStringRaw) {
      try {
        const parsed = JSON.parse(lineStringRaw);
        pathCoordinates.push(...parsed);
      } catch {
        // Some TfL legs do not include a parsable path.
      }
    }
  }

  return { totalMinutes: fastest.duration, legs, pathCoordinates };
}

export type { PropertyPoint, JourneyResult, LegDetail };
