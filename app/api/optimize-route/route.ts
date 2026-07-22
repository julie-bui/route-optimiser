import { NextRequest, NextResponse } from "next/server";
import { getJourney } from "@/app/lib/journey";
import type { JourneyResult, PropertyPoint } from "@/app/lib/journey";

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

  function routeTime(routeOrder: number[]) {
    let total = 0;
    for (let i = 0; i < routeOrder.length - 1; i++) {
      total += matrix[routeOrder[i]][routeOrder[i + 1]];
    }
    return total;
  }

  let improved = true;
  let bestOrder = order;
  let bestTime = routeTime(order);

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
        if (candidateTime < bestTime) {
          bestOrder = candidate;
          bestTime = candidateTime;
          improved = true;
        }
      }
    }
  }

  return bestOrder;
}

export async function POST(req: NextRequest) {
  const {
    properties,
    startIndex,
    viewingMinutesDefault,
    travelMode,
    tourDate,
    startTime,
  } = await req.json();
  const mode = travelMode || "publicTransport";

  const points: PropertyPoint[] = properties.map((p: any) => ({
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));

  try {
    const n = points.length;
    const departAt = new Date(`${tourDate}T${startTime}:00`).toISOString();

    const matrix: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(0)
    );
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

    const legDetailsByStep: (JourneyResult | null)[] = [null];
    for (let i = 1; i < order.length; i++) {
      const journey = await getJourney(
        points[order[i - 1]],
        points[order[i]],
        mode,
        departAt
      );
      legDetailsByStep.push(journey);
    }

    let currentTime = new Date(departAt);
    const stops = order.map((idx: number, i: number) => {
      const journey = legDetailsByStep[i];
      const viewingMinutes = properties[idx].viewingMinutes ?? viewingMinutesDefault ?? 15;
      const isUnreachable =
        (journey?.totalMinutes ?? 0) >= UNREACHABLE_PENALTY_MINUTES;

      if (i > 0 && journey && !isUnreachable) {
        currentTime = new Date(
          currentTime.getTime() + journey.totalMinutes * 60000
        );
      }

      const arrivalTime = currentTime.toISOString();

      currentTime = new Date(
        currentTime.getTime() + viewingMinutes * 60000
      );

      return {
        ...properties[idx],
        travelMinutesFromPrevious: isUnreachable
          ? null
          : (journey?.totalMinutes ?? 0),
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
        arrivalTime,
      };
    });

    const totalTravelMinutes = stops.reduce(
      (sum: number, stop: any) =>
        sum + (stop.travelMinutesFromPrevious ?? 0),
      0
    );
    const totalViewingMinutes = stops.reduce(
      (sum: number, stop: any) => sum + stop.viewingMinutes,
      0
    );

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
