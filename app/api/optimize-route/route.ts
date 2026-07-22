import { NextRequest, NextResponse } from "next/server";

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
};

function modeParamFor(travelMode: string): string {
  if (travelMode === "walking") return "walking";
  if (travelMode === "cycling") return "cycle";
  return "bus,tube,dlr,overground,elizabeth-line,national-rail,tram,walking"; // public transport
}

async function getJourney(from: PropertyPoint, to: PropertyPoint, travelMode: string): Promise<JourneyResult> {
  const mode = modeParamFor(travelMode);
  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?mode=${mode}&app_key=${process.env.TFL_API_KEY}`;

  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TfL journey request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`);
  }

  const data = await res.json();

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
  const { properties, startIndex, viewingMinutesDefault, travelMode } = await req.json();
  const mode = travelMode || "publicTransport";

  const points: PropertyPoint[] = properties.map((p: any) => ({
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));

  try {
    const n = points.length;

    // Step 1: build a quick total-time matrix (used only to decide the best order)
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          const journey = await getJourney(points[i], points[j], mode);
          matrix[i][j] = journey.totalMinutes;
        }
      }
    }

    const order = solveRoute(matrix, startIndex);

    // Step 2: for the actual chosen order, fetch full leg-by-leg detail for each consecutive pair
    const legDetailsByStep: (JourneyResult | null)[] = [null]; // first stop has no previous leg
    for (let i = 1; i < order.length; i++) {
      const journey = await getJourney(points[order[i - 1]], points[order[i]], mode);
      legDetailsByStep.push(journey);
    }

    const stops = order.map((idx, i) => {
      const journey = legDetailsByStep[i];
      const viewingMinutes = properties[idx].viewingMinutes ?? viewingMinutesDefault ?? 15;

      // Rough e-bike estimate: only meaningful when cycling mode is selected
      const estimatedEBikeMinutes =
        mode === "cycling" && journey ? Math.round(journey.totalMinutes * 0.8) : null;

      return {
        ...properties[idx],
        travelMinutesFromPrevious: journey?.totalMinutes ?? 0,
        legs: journey?.legs ?? [],
        estimatedEBikeMinutes,
        viewingMinutes,
      };
    });

    const totalTravelMinutes = stops.reduce((sum: number, s: any) => sum + s.travelMinutesFromPrevious, 0);
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
