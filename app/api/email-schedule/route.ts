import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function formatTime(arrivalTimeIso: string): string {
  const date = new Date(arrivalTimeIso);
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
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

  const scheduleLines = stops
    .map((stop: any, index: number) => {
      const time = stop.arrivalTime ? formatTime(stop.arrivalTime) : "";
      const viewing = stop.viewingMinutes ? `${stop.viewingMinutes} min` : "";
      const travel =
        index === 0
          ? ""
          : `${Math.round(stop.travelMinutesFromPrevious ?? 0)} min`;
      const mode = index === 0 ? "" : describeLegs(stop.legs);

      return `${index + 1}. ${time} - ${stop.address}
   Viewing time: ${viewing}
   Travel time: ${travel}
   Travel mode: ${mode}`;
    })
    .join("\n\n");

  try {
    const { data, error } = await resend.emails.send({
      from: "Spacepoint <viewings@spre.agency>",
      to: recipientEmail,
      subject: `Tour schedule - ${tourDate}`,
      text: `Hi,

Here is the full tour schedule for ${tourDate}:

${scheduleLines}
`,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, emailId: data?.id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
