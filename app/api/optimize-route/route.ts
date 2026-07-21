import { NextRequest, NextResponse } from "next/server";

type PropertyPoint = {
  address: string;
  lat: number;
  lng: number;
};

async function getTravelTimeMatrix(points: PropertyPoint[]): Promise<number[][]> {
  const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(";");

  const url = `https://us1.locationiq.com/v1/matrix/driving/${coordinates}?key=${process.env.LOCATIONIQ_ACCESS_TOKEN}&annotations=duration`;

  const res = await fetch(url);

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LocationIQ matrix request failed: ${res.status} ${errText}`);
  }

  const data = await res.json();

  if (!data.durations) {
    throw new Error(`LocationIQ matrix response missing durations: ${JSON.stringify(data)}`);
  }

  return data.durations; // seconds, [i][j] = travel time from i to j
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
