import { NextRequest, NextResponse } from "next/server";
import { getJourney } from "@/app/lib/journey";
import type { PropertyPoint } from "@/app/lib/journey";

export async function POST(req: NextRequest) {
  const { orderedStops, travelMode, tourDate, startTime } = await req.json();

  try {
    let currentTime = new Date(`${tourDate}T${startTime}:00`);
    const recalculated = [];

    for (let i = 0; i < orderedStops.length; i++) {
      const stop = orderedStops[i] as PropertyPoint & {
        viewingMinutes?: number;
      };

      if (i === 0) {
        recalculated.push({
          ...stop,
          arrivalTime: currentTime.toISOString(),
          travelMinutesFromPrevious: 0,
          legs: [],
        });
      } else {
        const departAt = currentTime.toISOString();
        const previousStop = orderedStops[i - 1] as PropertyPoint;
        const journey = await getJourney(
          previousStop,
          stop,
          travelMode,
          departAt
        );

        currentTime = new Date(
          currentTime.getTime() + journey.totalMinutes * 60000
        );

        recalculated.push({
          ...stop,
          arrivalTime: currentTime.toISOString(),
          travelMinutesFromPrevious: journey.totalMinutes,
          legs: journey.legs,
        });
      }

      currentTime = new Date(
        currentTime.getTime() + (stop.viewingMinutes ?? 15) * 60000
      );
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
