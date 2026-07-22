import { NextRequest, NextResponse } from "next/server";

type PropertyPoint = {
  address: string;
  lat: number;
  lng: number;
};

async function getJourneyDurationSeconds(from: PropertyPoint, to: PropertyPoint): Promise<number> {
  const url = `https://api.tfl.gov.uk/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?app_key=${process.env.TFL_API_KEY}`;

  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`TfL journey request failed (${from.address} -> ${to.address}): ${res.status} ${errText}`);
  }

  const data = await res.json();

  console.log(`TfL raw response for ${from.address} -> ${to.address}:`, JSON.stringify(data.journeys?.map((j: any) => ({ duration: j.duration, legs: j.legs?.map((l: any) => l.mode?.name) })), null, 2));

  if (!data.journeys || data.journeys.length === 0) {
    throw new Error(`No TfL journey found between "${from.address}" and "${to.address}"`);
  }

  // TfL returns duration in minutes; take the fastest journey option
  const fastest = data.journeys.reduce((min: any, j: any) =>
    j.duration < min.duration ? j : min
  );

  return fastest.duration * 60; // convert minutes to seconds
}

async function getTravelTimeMatrix(points: PropertyPoint[]): Promise<number[][]> {
  const n = points.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  // TfL has no batch/matrix endpoint, so call pairwise.
  // At this app's scale (a handful of properties per tour) this is fine.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        matrix[i][j] = await getJourneyDurationSeconds(points[i], points[j]);
      }
    }
  }

  return matrix;
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
  const { properties, startIndex, viewingMinutesDefault } = await req.json();

  const points: PropertyPoint[] = properties.map((p: any) => ({
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));

  try {
    const matrix = await getTravelTimeMatrix(points);

    for (let i = 0; i < matrix.length; i++) {
      for (let j = 0; j < matrix.length; j++) {
        if (i !== j && (matrix[i][j] === undefined || matrix[i][j] === null || !isFinite(matrix[i][j]))) {
          throw new Error(
            `No route found between "${properties[i].address}" and "${properties[j].address}"`
          );
        }
      }
    }

    const order = solveRoute(matrix, startIndex);

    const stops = order.map((idx, i) => {
      const travelSeconds = i === 0 ? 0 : matrix[order[i - 1]][idx];
      return {
        ...properties[idx],
        travelSecondsFromPrevious: travelSeconds,
        viewingMinutes: properties[idx].viewingMinutes ?? viewingMinutesDefault ?? 15,
      };
    });

    const totalTravelSeconds = stops.reduce((sum: number, s: any) => sum + s.travelSecondsFromPrevious, 0);
    const totalViewingMinutes = stops.reduce((sum: number, s: any) => sum + s.viewingMinutes, 0);

    return NextResponse.json({
      stops,
      totalTravelSeconds,
      totalViewingMinutes,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
