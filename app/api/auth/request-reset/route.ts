import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { Resend } from "resend";
import crypto from "crypto";

const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const { email } = await req.json();

  if (!email) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always return success even if user doesn't exist, to avoid revealing which emails are registered
  if (!user) {
    return NextResponse.json({ success: true });
  }

  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

  await prisma.user.update({
    where: { email },
    data: { resetToken, resetTokenExpiry },
  });

  const resetUrl = `${process.env.NEXTAUTH_URL}/reset-password?token=${resetToken}`;

  try {
    await resend.emails.send({
      from: "Spacepoint <viewings@spre.agency>",
      to: email,
      subject: "Reset your password",
      html: `<div style="font-family: Arial, sans-serif; font-size: 14px;">
<p>Hi,</p>
<p>Click the link below to reset your password. This link expires in 1 hour.</p>
<p><a href="${resetUrl}">${resetUrl}</a></p>
<p>If you didn't request this, you can safely ignore this email.</p>
</div>`,
    });
  } catch (err) {
    console.error("Failed to send reset email:", err);
  }

  return NextResponse.json({ success: true });
}
