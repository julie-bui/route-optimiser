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
    const recipients = Array.isArray(stop.recipients)
      ? stop.recipients.filter(
          (
            recipient: unknown
          ): recipient is { email: string; name?: string | null } =>
            typeof recipient === "object" &&
            recipient !== null &&
            typeof (recipient as { email?: unknown }).email === "string" &&
            (recipient as { email: string }).email.trim().includes("@")
        )
      : Array.isArray(stop.recipientEmails)
        ? stop.recipientEmails
            .filter(
              (email: unknown): email is string =>
                typeof email === "string" && email.trim().includes("@")
            )
            .map((email: string) => ({ email, name: null }))
        : [];

    if (recipients.length === 0) {
      results.push({
        address: stop.address,
        status: "skipped",
        reason: "No agent email available",
        sentTo: null,
      });
      continue;
    }

    const viewingTime = formatTime(stop.arrivalTime);
    const dateFormatted = formatDate(tourDate);

    for (const recipient of recipients) {
      const recipientEmail = recipient.email.trim();
      const greetingName =
        typeof recipient.name === "string" && recipient.name.trim().length > 0
          ? recipient.name.trim().split(" ")[0]
          : "Agent";

      try {
        const { data, error } = await resend.emails.send({
          from: "Spacepoint <viewings@spre.agency>",
          to: recipientEmail,
          cc: validCcEmails.length > 0 ? validCcEmails : undefined,
          subject: `Viewing request - ${stop.address}`,
          text: `Dear ${greetingName},

I'd like to arrange a viewing of ${stop.address} on ${dateFormatted} at ${viewingTime}.

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

