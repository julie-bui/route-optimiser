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
  const { stops, tourDate, ccEmails } = await req.json();
  console.log(
    "Stops received:",
    JSON.stringify(
      stops.map((stop: any) => ({
        address: stop.address,
        recipientEmails: stop.recipientEmails,
      })),
      null,
      2
    )
  );

  const key = process.env.RESEND_API_KEY;
  console.log(
    "Resend key loaded (masked):",
    key ? `${key.slice(0, 6)}...${key.slice(-4)}` : "MISSING"
  );

  const results = [];
  const validCcEmails = Array.isArray(ccEmails)
    ? ccEmails
        .filter(
          (email: string) =>
            typeof email === "string" && email.trim().includes("@")
        )
        .map((email: string) => email.trim())
    : [];

  for (const stop of stops) {
    const recipientEmails = Array.isArray(stop.recipientEmails)
      ? stop.recipientEmails.filter(
          (email: unknown): email is string =>
            typeof email === "string" && email.trim().includes("@")
        )
      : [];

    if (recipientEmails.length === 0) {
      results.push({
        address: stop.address,
        status: "skipped",
        reason: "No agent email available",
        sentTo: null,
      });
      continue;
    }

    console.log(
      `Stop "${stop.address}" arrivalTime raw value:`,
      stop.arrivalTime,
      typeof stop.arrivalTime
    );
    const viewingTime = formatTime(stop.arrivalTime);
    const dateFormatted = formatDate(tourDate);

    for (const recipientEmail of recipientEmails) {
      try {
        console.log(`Sending to (raw):`, JSON.stringify(recipientEmail));
        const { data, error } = await resend.emails.send({
          from: "viewings@spre.agency",
          to: recipientEmail,
          cc: validCcEmails.length > 0 ? validCcEmails : undefined,
          subject: `Viewing request - ${stop.address}`,
          text: `Dear agent,

We'd like to arrange a viewing of ${stop.address} on ${dateFormatted} at ${viewingTime}.

Could you confirm whether this time works, or suggest an alternative?

Thank you,
Mark and Laurie
`,
        });

        if (error) {
          results.push({
            address: stop.address,
            status: "failed",
            reason: error.message,
            sentTo: recipientEmail,
          });
        } else {
          results.push({
            address: stop.address,
            status: "sent",
            emailId: data?.id,
            sentTo: recipientEmail,
          });
        }
      } catch (err: any) {
        results.push({
          address: stop.address,
          status: "failed",
          reason: err.message,
          sentTo: recipientEmail,
        });
      }
    }
  }

  return NextResponse.json({ results });
}

