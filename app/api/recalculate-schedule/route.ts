import { NextRequest, NextResponse } from "next/server";
import { getJourney } from "@/app/lib/journey";
import type { PropertyPoint } from "@/app/lib/journey";
import {
  externalStartPoint,
  validateStartLocationPayload,
} from "@/app/lib/startLocation";

export async function POST(req: NextRequest) {
  const {
    orderedStops,
    travelMode,
    tourDate,
    startTime,
    editedFromIndex,
    startLocation,
  } = await req.json();

  if (!Array.isArray(orderedStops) || orderedStops.length === 0) {
    return NextResponse.json(
      { error: "At least one stop is required to recalculate a schedule." },
      { status: 400 }
    );
  }

  const startLocationError = validateStartLocationPayload(startLocation);
  if (startLocationError) {
    return NextResponse.json({ error: startLocationError }, { status: 400 });
  }

  // null for a property start (stop 0 IS the origin, no incoming route); the
  // resolved external point otherwise, needed to re-fetch the "start -> stop 0"
  // route for display (map/legs/mode) - its duration is never counted, though.
  const startPoint: PropertyPoint | null = externalStartPoint(startLocation);

  try {
    let currentTime = new Date(`${tourDate}T${startTime}:00`);
    const recalculated: any[] = [];

    const skipRefetchBefore = typeof editedFromIndex === "number" ? editedFromIndex : 0;

    for (let i = 0; i < orderedStops.length; i++) {
      const stop = orderedStops[i] as PropertyPoint & {
        viewingMinutes?: number;
        arrivalTime?: string;
        travelMinutesFromPrevious?: number;
        routeMinutesFromPrevious?: number | null;
        legs?: any[];
        pathCoordinates?: [number, number][];
      };

      if (i === 0) {
        // stops[0] is always the start of the actual tour schedule, regardless
        // of whether the selected starting point was the office, a custom
        // address, or a property - so it always has zero COUNTED travel time
        // and starts at the chosen startTime. Recomputed fresh (rather than
        // reused from cache) so this stays correct even if tourDate/startTime
        // changed, or the first property changed after a reorder/edit.
        //
        // When the start is external, still fetch its route into stop 0 -
        // legs/pathCoordinates/mode - purely for display on the map/route
        // details. That route's duration is kept in routeMinutesFromPrevious
        // for display only; it never advances currentTime or counts toward
        // travelMinutesFromPrevious/totals.
        currentTime = new Date(`${tourDate}T${startTime}:00`);

        if (startPoint) {
          const journey = await getJourney(
            startPoint,
            stop,
            travelMode,
            currentTime.toISOString()
          );
          recalculated.push({
            ...stop,
            arrivalTime: currentTime.toISOString(),
            travelMinutesFromPrevious: 0,
            routeMinutesFromPrevious: journey.totalMinutes,
            legs: journey.legs,
            pathCoordinates: journey?.pathCoordinates ?? [],
          });
        } else {
          recalculated.push({
            ...stop,
            arrivalTime: currentTime.toISOString(),
            travelMinutesFromPrevious: 0,
            routeMinutesFromPrevious: null,
            legs: [],
            pathCoordinates: [],
          });
        }
      } else if (i < skipRefetchBefore && stop.arrivalTime && stop.travelMinutesFromPrevious !== undefined) {
        // This leg is before the edited stop and unaffected - reuse its known data,
        // just replay the cumulative clock instead of calling getJourney again.
        currentTime = new Date(currentTime.getTime() + (stop.travelMinutesFromPrevious ?? 0) * 60000);
        recalculated.push({
          ...stop,
          arrivalTime: currentTime.toISOString(),
          travelMinutesFromPrevious: stop.travelMinutesFromPrevious,
          routeMinutesFromPrevious: stop.routeMinutesFromPrevious ?? stop.travelMinutesFromPrevious,
          legs: stop.legs ?? [],
          pathCoordinates: stop.pathCoordinates ?? [],
        });
      } else {
        const departAt = currentTime.toISOString();
        const previousStop = orderedStops[i - 1] as PropertyPoint;
        const journey = await getJourney(previousStop, stop, travelMode, departAt);

        currentTime = new Date(currentTime.getTime() + journey.totalMinutes * 60000);

        recalculated.push({
          ...stop,
          arrivalTime: currentTime.toISOString(),
          travelMinutesFromPrevious: journey.totalMinutes,
          routeMinutesFromPrevious: journey.totalMinutes,
          legs: journey.legs,
          pathCoordinates: journey?.pathCoordinates ?? [],
        });
      }

      currentTime = new Date(currentTime.getTime() + (stop.viewingMinutes ?? 15) * 60000);
    }

    const totalTravelMinutes = recalculated.reduce(
      (sum, stop) => sum + (stop.travelMinutesFromPrevious || 0),
      0
    );

    return NextResponse.json({ stops: recalculated, totalTravelMinutes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
