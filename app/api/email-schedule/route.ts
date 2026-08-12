import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { keepOnlyMobileNumber } from "@/app/lib/phoneFilter";
import {
  formatRoundedTime,
  roundUpMinutesToFive,
} from "../../lib/timeFormat";

const resend = new Resend(process.env.RESEND_API_KEY);

function formatTime(arrivalTimeIso: string): string {
  return formatRoundedTime(arrivalTimeIso);
}

function describeLegs(legs: any[] | undefined): string {
  if (!legs || legs.length === 0) return "";

  return legs
    .map((leg) => {
      if (leg.mode === "walking") return "Walk";
      if (leg.mode === "bus") return `Bus ${leg.lineName || ""}`.trim();
      if (leg.mode === "tube") return `Tube (${leg.lineName || ""})`.trim();
      if (leg.mode === "national-rail") {
        return `Train (${leg.lineName || ""})`.trim();
      }
      if (leg.mode === "cycle") return "Cycle";
      if (leg.mode === "car") return "Car";
      if (leg.mode === "taxi") return "Taxi";
      return leg.mode;
    })
    .join(", ");
}

export async function POST(req: NextRequest) {
  const { stops, recipientEmail, tourDate } = await req.json();

  if (!recipientEmail) {
    return NextResponse.json(
      { error: "No recipient email provided" },
      { status: 400 }
    );
  }

  const scheduleLinesHtml = stops.map((stop: any, i: number) => {
    const time = stop.arrivalTime ? formatTime(stop.arrivalTime) : "";
    const viewing = stop.viewingMinutes ? `${stop.viewingMinutes} min` : "";
    // stops[0] is always the start of the actual tour, so its travel time is
    // blank/uncounted even when an external start's route into it is shown via
    // the travel mode line below - only the DURATION is excluded, not the
    // route itself.
    const hasCountedTravelTime = i > 0;
    const travel = hasCountedTravelTime
      ? `${roundUpMinutesToFive(stop.travelMinutesFromPrevious ?? 0)} min`
      : "";
    const mode = describeLegs(stop.legs);

    const agentNames = (stop.recipients || [])
      .map((r: any) => r.name)
      .filter(Boolean)
      .join(", ") || "N/A";
    const agentPhones = (stop.recipients || [])
      .map((r: any) => keepOnlyMobileNumber(r.phone))
      .filter(Boolean)
      .join(", ") || "N/A";

    return `<p style="margin: 0 0 4px 0;"><strong>${i + 1}. ${time} - ${stop.address}</strong></p>
<p style="margin: 0 0 2px 0;">Agent: ${agentNames}</p>
<p style="margin: 0 0 2px 0;">Number: ${agentPhones}</p>
<p style="margin: 0 0 2px 0;">Viewing time: ${viewing}</p>
<p style="margin: 0 0 2px 0;">Travel time: ${travel}</p>
<p style="margin: 0 0 16px 0;">Travel mode: ${mode}</p>`;
  }).join("");

  try {
    const { data, error } = await resend.emails.send({
      from: "Spacepoint <viewings@spre.agency>",
      to: recipientEmail,
      subject: `Tour schedule - ${tourDate}`,
      html: `<div style="font-family: Arial, sans-serif; font-size: 14px; color: #000;">
<p>Hi,</p>
<p>Here is the full tour schedule for ${tourDate}:</p>
${scheduleLinesHtml}
</div>`,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: data?.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
