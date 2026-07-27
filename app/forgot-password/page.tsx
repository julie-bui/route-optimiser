"use client";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);

    await fetch("/api/auth/request-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    setSending(false);
    setSubmitted(true);
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Reset your password</h1>

      {submitted ? (
        <p style={{ fontSize: 14, color: "#0f6e56" }}>
          If an account exists with that email, a reset link has been sent. Check your inbox.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
          />
          <button
            type="submit"
            disabled={sending}
            style={{ width: "100%", padding: "10px", background: "#000", color: "#fff", border: "none", borderRadius: 4, opacity: sending ? 0.6 : 1 }}
          >
            {sending ? "Sending..." : "Send reset link"}
          </button>
        </form>
      )}
    </main>
  );
}
