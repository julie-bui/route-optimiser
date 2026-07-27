"use client";
import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function ResetPasswordPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword !== confirmPassword) {
      setMessage({ text: "Passwords don't match", isError: true });
      return;
    }

    if (!token) {
      setMessage({ text: "Invalid reset link", isError: true });
      return;
    }

    setSaving(true);

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });

    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setMessage({ text: data.error || "Something went wrong", isError: true });
    } else {
      setMessage({ text: "Password reset. Redirecting to login...", isError: false });
      setTimeout(() => router.push("/login"), 2000);
    }
  }

  if (!token) {
    return (
      <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
        <p style={{ color: "#a32d2d" }}>This reset link is invalid.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Set a new password</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>New password</label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Confirm new password</label>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />
        {message && (
          <p style={{ fontSize: 13, color: message.isError ? "#a32d2d" : "#0f6e56", marginBottom: 12 }}>
            {message.text}
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          style={{ width: "100%", padding: "10px", background: "#000", color: "#fff", border: "none", borderRadius: 4, opacity: saving ? 0.6 : 1 }}
        >
          {saving ? "Saving..." : "Reset password"}
        </button>
      </form>
    </main>
  );
}
