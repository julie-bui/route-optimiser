import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(arrivalTimeIso: string): string {
  const d = new Date(arrivalTimeIso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function POST(req: NextRequest) {
  const { stops, tourDate, ccEmail } = await req.json();

  const results = [];

  for (const stop of stops) {
    if (!stop.agentEmail) {
      results.push({
        address: stop.address,
        status: "skipped",
        reason: "No agent email available",
      });
      continue;
    }

    const viewingTime = formatTime(stop.arrivalTime);
    const dateFormatted = formatDate(tourDate);

    try {
      const { data, error } = await resend.emails.send({
        from: "onboarding@resend.dev",
        to: stop.agentEmail,
        cc: ccEmail ? [ccEmail] : undefined,
        subject: `Viewing request - ${stop.address}`,
        text: `Hello${stop.agentName ? ` ${stop.agentName}` : ""},

I'd like to arrange a viewing of ${stop.address} on ${dateFormatted} at ${viewingTime}.

Could you confirm whether this time works, or suggest an alternative?

Thank you,
`,
      });

      if (error) {
        results.push({
          address: stop.address,
          status: "failed",
          reason: error.message,
        });
      } else {
        results.push({
          address: stop.address,
          status: "sent",
          emailId: data?.id,
        });
      }
    } catch (err: any) {
      results.push({
        address: stop.address,
        status: "failed",
        reason: err.message,
      });
    }
  }

  return NextResponse.json({ results });
}
