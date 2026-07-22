import { NextRequest, NextResponse } from "next/server";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type PropertyPoint = {
  address: string;
  lat: number;
  lng: number;
};

type LegDetail = {
  mode: string;
  durationMinutes: number;
  lineName: string;
};

type JourneyResult = {
  totalMinutes: number;
  legs: LegDetail[];
  unreachable?: boolean;
  unreachableReason?: string;
  estimatedTaxiNote?: string;
};

async function getWalkingJourney(
  from: PropertyPoint,
  to: PropertyPoint
): Promise<JourneyResult> {
  await sleep(600);
  const url = `https://us1.locationiq.com/v1/directions/walking/${from.lng},${from.lat};${to.lng},${to.lat}?key=${process.env.LOCATIONIQ_ACCESS_TOKEN}&overview=false`;

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

  return {
    totalMinutes: minutes,
    legs: [
      {
        mode: "walking",
        durationMinutes: Math.round(minutes),
        lineName: "walking route",
      },
    ],
  };
}

async function getCarJourney(
  from: PropertyPoint,
  to: PropertyPoint,
  departAt: string
): Promise<JourneyResult> {
  const url = `https://api.tomtom.com/routing/matrix/2?key=${process.env.TOMTOM_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      origins: [{ point: { latitude: from.lat, longitude: from.lng } }],
      destinations: [{ point: { latitude: to.lat, longitude: to.lng } }],
      options: { routeType: "fastest", traffic: "live", departAt },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `TomTom request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`
    );
  }

  const data = await res.json();
  const cell = data.data?.[0];
  const seconds = cell?.routeSummary?.travelTimeInSeconds;

  if (seconds === undefined || seconds === null) {
    throw new Error(`No driving route found between "${from.address}" and "${to.address}"`);
  }

  return {
    totalMinutes: seconds / 60,
    legs: [
      {
        mode: "car",
        durationMinutes: Math.round(seconds / 60),
        lineName: "driving",
      },
    ],
  };
}

function modeParamFor(travelMode: string): string {
  if (travelMode === "walking") return "walking";
  if (travelMode === "cycling") return "cycle";
  return "bus,tube,dlr,overground,elizabeth-line,national-rail,tram,walking"; // public transport
}

async function getJourney(
  from: PropertyPoint,
  to: PropertyPoint,
  travelMode: string,
  departAt?: string
): Promise<JourneyResult> {
  if (travelMode === "walking") {
    return getWalkingJourney(from, to);
  }

  if (travelMode === "car" || travelMode === "taxi") {
    const carResult = await getCarJourney(from, to, departAt || new Date().toISOString());

    if (travelMode === "taxi") {
      const pickupWaitMinutes = 5;
      return {
        totalMinutes: carResult.totalMinutes + pickupWaitMinutes,
        legs: [
          {
            mode: "taxi",
            durationMinutes: Math.round(carResult.totalMinutes),
            lineName: "driving",
          },
        ],
        estimatedTaxiNote: `Includes an estimated ${pickupWaitMinutes} min pickup wait - not based on live driver availability or pricing.`,
      };
    }

    return carResult;
  }

  const mode = modeParamFor(travelMode);
  let url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?mode=${mode}&app_key=${process.env.TFL_API_KEY}`;

  const res = await fetch(url);

  if (res.status === 404) {
    const errText = await res.text();
    throw new Error(
      `TfL returned no journey for mode "${travelMode}" between "${from.address}" and "${to.address}": ${errText}`
    );
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TfL journey request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`);
  }

  const data = await res.json();

  console.log(
    `TfL response status for ${from.address} -> ${to.address} (mode: ${travelMode}):`,
    res.status,
    "journeys count:",
    data.journeys?.length,
    "first journey duration:",
    data.journeys?.[0]?.duration
  );

  if (!data.journeys || data.journeys.length === 0) {
    throw new Error(`No journey found between "${from.address}" and "${to.address}" for mode "${travelMode}"`);
  }

  const fastest = data.journeys.reduce((min: any, j: any) => (j.duration < min.duration ? j : min));

  const legs: LegDetail[] = (fastest.legs || []).map((leg: any) => {
    const lineName =
      leg.routeOptions?.[0]?.name ||
      leg.instruction?.detailed ||
      leg.mode?.name ||
      "unknown";
    return {
      mode: leg.mode?.name || "unknown",
      durationMinutes: leg.duration ?? 0,
      lineName,
    };
  });

  return { totalMinutes: fastest.duration, legs };
}

function solveRoute(matrix: number[][], startIndex: number): number[] {
  const n = matrix.length;
  const visited = new Array(n).fill(false);
  const order = [startIndex];
  visited[startIndex] = true;

  let current = startIndex;
  for (let step = 1; step < n; step++) {
    let best = -1;
    let bestTime = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && matrix[current][j] < bestTime) {
        bestTime = matrix[current][j];
        best = j;
      }
    }
    order.push(best);
    visited[best] = true;
    current = best;
  }

  function routeTime(o: number[]) {
    let total = 0;
    for (let i = 0; i < o.length - 1; i++) total += matrix[o[i]][o[i + 1]];
    return total;
  }

  let improved = true;
  let bestOrder = order;
  let bestTime2 = routeTime(order);

  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const candidate = [
          ...bestOrder.slice(0, i),
          ...bestOrder.slice(i, j + 1).reverse(),
          ...bestOrder.slice(j + 1),
        ];
        const candidateTime = routeTime(candidate);
        if (candidateTime < bestTime2) {
          bestOrder = candidate;
          bestTime2 = candidateTime;
          improved = true;
        }
      }
    }
  }

  return bestOrder;
}

export async function POST(req: NextRequest) {
  const { properties, startIndex, viewingMinutesDefault, travelMode, tourDate, startTime } =
    await req.json();
  const mode = travelMode || "publicTransport";

  const points: PropertyPoint[] = properties.map((p: any) => ({
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));

  try {
    const n = points.length;
    const departAt = new Date(`${tourDate}T${startTime}:00`).toISOString();

    // Step 1: build a quick total-time matrix (used only to decide the best order)
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          const journey = await getJourney(points[i], points[j], mode, departAt);
          matrix[i][j] = journey.totalMinutes;
        }
      }
    }

    const UNREACHABLE_PENALTY_MINUTES = 999;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (
          i !== j &&
          (matrix[i][j] === undefined ||
            matrix[i][j] === null ||
            !Number.isFinite(matrix[i][j]))
        ) {
          matrix[i][j] = UNREACHABLE_PENALTY_MINUTES;
        }
      }
    }

    const order = solveRoute(matrix, startIndex);

    // Step 2: for the actual chosen order, fetch full leg-by-leg detail for each consecutive pair
    const legDetailsByStep: (JourneyResult | null)[] = [null]; // first stop has no previous leg
    for (let i = 1; i < order.length; i++) {
      const journey = await getJourney(
        points[order[i - 1]],
        points[order[i]],
        mode,
        departAt
      );
      legDetailsByStep.push(journey);
    }

    const stops = order.map((idx, i) => {
      const journey = legDetailsByStep[i];
      const viewingMinutes = properties[idx].viewingMinutes ?? viewingMinutesDefault ?? 15;
      const isUnreachable =
        (journey?.totalMinutes ?? 0) >= UNREACHABLE_PENALTY_MINUTES;

      return {
        ...properties[idx],
        travelMinutesFromPrevious: isUnreachable ? null : (journey?.totalMinutes ?? 0),
        legs: isUnreachable ? [] : (journey?.legs ?? []),
        unreachable: isUnreachable,
        unreachableReason: isUnreachable
          ? "No route found for this travel mode between these two stops - try switching travel mode."
          : null,
        estimatedEBikeMinutes:
          mode === "cycling" && journey && !isUnreachable
            ? Math.round(journey.totalMinutes * 0.8)
            : null,
        estimatedTaxiNote: journey?.estimatedTaxiNote ?? null,
        viewingMinutes,
      };
    });

    const totalTravelMinutes = stops.reduce(
      (sum: number, s: any) => sum + (s.travelMinutesFromPrevious ?? 0),
      0
    );
    const totalViewingMinutes = stops.reduce((sum: number, s: any) => sum + s.viewingMinutes, 0);

    return NextResponse.json({
      stops,
      totalTravelMinutes,
      totalViewingMinutes,
      travelMode: mode,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
