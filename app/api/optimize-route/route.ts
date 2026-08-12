import { NextRequest, NextResponse } from "next/server";
import { getJourney } from "@/app/lib/journey";
import type { JourneyResult, PropertyPoint } from "@/app/lib/journey";
import {
  externalStartPoint,
  validateExternalCoordinates,
  validateStartLocationPayload,
} from "@/app/lib/startLocation";

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
  const body = await req.json();
  const {
    properties,
    startLocation,
    viewingMinutesDefault,
    travelMode,
    tourDate,
    startTime,
  } = body;

  if (!Array.isArray(properties) || properties.length === 0) {
    return NextResponse.json(
      { error: "At least one property is required to plan a route." },
      { status: 400 }
    );
  }

  const startLocationError = validateStartLocationPayload(
    startLocation,
    properties.length
  );
  if (startLocationError) {
    return NextResponse.json({ error: startLocationError }, { status: 400 });
  }

  for (const property of properties) {
    const coordError = validateExternalCoordinates(property?.lat, property?.lng);
    if (coordError) {
      return NextResponse.json(
        {
          error: `Property "${property?.address ?? "unknown"}" has invalid coordinates.`,
        },
        { status: 400 }
      );
    }
  }

  const mode = travelMode || "publicTransport";

  const propertyPoints: PropertyPoint[] = properties.map((p: any) => ({
    address: p.address,
    lat: p.lat,
    lng: p.lng,
  }));

  // An external start (office/custom) is optimised as a locked point at index 0 of
  // an extended point list, so the "start -> first property" leg genuinely factors
  // into route ORDER rather than being bolted on afterwards. A property start keeps
  // the original single-array behaviour untouched. Either way, that leg never
  // appears in the returned SCHEDULE: stops[0] is always the start of the actual
  // tour (see hasIncomingLeg below), so it never has an incoming travel leg.
  const startPoint = externalStartPoint(startLocation);
  const hasExternalStart = startPoint !== null;
  const points: PropertyPoint[] = hasExternalStart
    ? [startPoint, ...propertyPoints]
    : propertyPoints;
  const lockedStartIndex = hasExternalStart ? 0 : startLocation.propertyIndex;

  try {
    const n = points.length;
    const departAt = new Date(`${tourDate}T${startTime}:00`).toISOString();

    const matrix: number[][] = Array.from({ length: n }, () =>
      new Array(n).fill(0)
    );
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        // Nothing ever routes back to an external start - it is locked at position 0
        // and solveRoute never revisits it, so skip the wasted journey lookup.
        if (hasExternalStart && j === 0) continue;
        const journey = await getJourney(points[i], points[j], mode, departAt);
        matrix[i][j] = journey.totalMinutes;
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

    const order = solveRoute(matrix, lockedStartIndex);

    const legDetailsByStep: (JourneyResult | null)[] = [null];
    for (let i = 1; i < order.length; i++) {
      // The external start -> first property leg (i === 1 when hasExternalStart)
      // only ever mattered for choosing route order, which is already baked into
      // `order` via the matrix above. It must never appear in the schedule, so
      // skip fetching its full journey detail entirely.
      if (hasExternalStart && i === 1) {
        legDetailsByStep.push(null);
        continue;
      }
      const journey = await getJourney(
        points[order[i - 1]],
        points[order[i]],
        mode,
        departAt
      );
      legDetailsByStep.push(journey);
    }

    // `order` indexes into `points`, which may have the external start prepended at
    // index 0. Drop that entry from the output - it must never appear as a viewing
    // stop, and its leg into the first property must never appear in the schedule
    // either (see legDetailsByStep above and hasIncomingLeg below).
    const propertyOrder = hasExternalStart ? order.slice(1) : order;
    const legForPropertyStep = hasExternalStart
      ? legDetailsByStep.slice(1)
      : legDetailsByStep;
    const toPropertyIndex = (pointIndex: number) =>
      hasExternalStart ? pointIndex - 1 : pointIndex;

    let currentTime = new Date(departAt);
    const stops = propertyOrder.map((pointIdx: number, i: number) => {
      const propertyIdx = toPropertyIndex(pointIdx);
      const journey = legForPropertyStep[i];
      const viewingMinutes =
        properties[propertyIdx].viewingMinutes ?? viewingMinutesDefault ?? 15;
      const isUnreachable =
        (journey?.totalMinutes ?? 0) >= UNREACHABLE_PENALTY_MINUTES;
      // stops[0] is always the start of the actual tour and therefore has no
      // incoming tour travel leg, regardless of whether the selected starting
      // point was the office, a custom address, or a property. Any external
      // start -> first property leg only ever influenced route ORDER above.
      const hasIncomingLeg = i > 0;

      if (hasIncomingLeg && journey && !isUnreachable) {
        currentTime = new Date(
          currentTime.getTime() + journey.totalMinutes * 60000
        );
      }

      const arrivalTime = currentTime.toISOString();

      currentTime = new Date(
        currentTime.getTime() + viewingMinutes * 60000
      );

      return {
        ...properties[propertyIdx],
        travelMinutesFromPrevious: !hasIncomingLeg
          ? 0
          : isUnreachable
            ? null
            : (journey?.totalMinutes ?? 0),
        legs: !hasIncomingLeg || isUnreachable ? [] : (journey?.legs ?? []),
        unreachable: hasIncomingLeg && isUnreachable,
        unreachableReason:
          hasIncomingLeg && isUnreachable
            ? "No route found for this travel mode between these two stops - try switching travel mode."
            : null,
        estimatedEBikeMinutes:
          mode === "cycling" && hasIncomingLeg && journey && !isUnreachable
            ? Math.round(journey.totalMinutes * 0.8)
            : null,
        estimatedTaxiNote: hasIncomingLeg
          ? journey?.estimatedTaxiNote ?? null
          : null,
        pathCoordinates: !hasIncomingLeg ? [] : (journey?.pathCoordinates ?? []),
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
