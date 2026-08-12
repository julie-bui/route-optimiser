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
  // the original single-array behaviour untouched. Either way, the tour SCHEDULE
  // always begins at Property 1 (see countsTowardSchedule below): an external
  // start's route into it is still fetched and returned for display (legs,
  // pathCoordinates, mode), but its duration never advances the clock or counts
  // toward totals.
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

    // Full journey detail (legs, pathCoordinates, mode) for every step along the
    // chosen order, INCLUDING the external start -> first property leg (i === 1
    // when hasExternalStart) - that leg is still needed for the map/route display
    // even though its duration is excluded from the schedule further down.
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

    // `order` indexes into `points`, which may have the external start prepended at
    // index 0. Drop that entry from the output - it must never appear as a viewing
    // stop - while keeping the leg *into* the first property (computed above) for
    // display purposes.
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

      // Two independent concepts for stop 0:
      //   hasIncomingRoute     - is there an actual journey INTO this stop to
      //                          show on the map/route details (legs, path,
      //                          mode)? A property start has none. An external
      //                          start (office/custom) has a real one.
      //   countsTowardSchedule - should that journey's duration advance the
      //                          tour clock and be summed into
      //                          totalTravelMinutes? Only true for i > 0 - the
      //                          tour schedule always begins at Property 1,
      //                          regardless of where the optimiser started.
      const hasIncomingRoute = hasExternalStart ? true : i > 0;
      const countsTowardSchedule = i > 0;

      if (countsTowardSchedule && journey && !isUnreachable) {
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
        // Counted schedule travel time - always 0 for stop 0, even when an
        // external start's real route into it is retained below for display.
        travelMinutesFromPrevious: !countsTowardSchedule
          ? 0
          : isUnreachable
            ? null
            : (journey?.totalMinutes ?? 0),
        // Raw duration of the actual incoming route, for display only. Equal
        // to travelMinutesFromPrevious for every stop except stop 0 with an
        // external start, where it carries the real (schedule-excluded)
        // duration so the map/route details can still show it.
        routeMinutesFromPrevious: !hasIncomingRoute
          ? null
          : isUnreachable
            ? null
            : (journey?.totalMinutes ?? 0),
        legs: !hasIncomingRoute || isUnreachable ? [] : (journey?.legs ?? []),
        unreachable: hasIncomingRoute && isUnreachable,
        unreachableReason:
          hasIncomingRoute && isUnreachable
            ? "No route found for this travel mode between these two stops - try switching travel mode."
            : null,
        estimatedEBikeMinutes:
          mode === "cycling" && hasIncomingRoute && journey && !isUnreachable
            ? Math.round(journey.totalMinutes * 0.8)
            : null,
        estimatedTaxiNote: hasIncomingRoute
          ? journey?.estimatedTaxiNote ?? null
          : null,
        pathCoordinates: !hasIncomingRoute ? [] : (journey?.pathCoordinates ?? []),
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
