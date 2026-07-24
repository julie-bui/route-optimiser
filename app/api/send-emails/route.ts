import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { formatRoundedTime } from "../../lib/timeFormat";

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
  return formatRoundedTime(arrivalTimeIso);
}

function fillTemplate(
  template: string,
  values: { [key: string]: string }
): string {
  let result = template;
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}

const DEFAULT_SUBJECT = "Viewing request - {address}";
const DEFAULT_BODY = `Dear {name},

I'd like to arrange a viewing of {address} on {date} at {time}.

Thank you,
Spacepoint Team`;

export async function POST(req: NextRequest) {
  const { stops, tourDate, ccEmails, emailSubject, emailBody } =
    await req.json();

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
      const filledSubject = fillTemplate(emailSubject || DEFAULT_SUBJECT, {
        address: stop.address,
        name: greetingName,
        date: dateFormatted,
        time: viewingTime,
      });
      const filledBody = fillTemplate(emailBody || DEFAULT_BODY, {
        address: stop.address,
        name: greetingName,
        date: dateFormatted,
        time: viewingTime,
      });

      try {
        const { data, error } = await resend.emails.send({
          from: "Spacepoint <viewings@spre.agency>",
          to: recipientEmail,
          replyTo: "juliehamibui@outlook.com",
          cc: validCcEmails.length > 0 ? validCcEmails : undefined,
          subject: filledSubject,
          text: filledBody,
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

