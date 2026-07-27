"use client";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function AccountPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  if (status === "loading") return <main style={{ padding: 40 }}>Loading...</main>;
  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);

    if (newPassword && newPassword !== confirmPassword) {
      setMessage({ text: "New passwords don't match", isError: true });
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/account/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newEmail: newEmail || undefined,
          newPassword: newPassword || undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage({ text: data.error || "Something went wrong", isError: true });
      } else {
        setMessage({ text: "Account updated. Please sign in again with your new details.", isError: false });
        setTimeout(() => signOut({ callbackUrl: "/login" }), 2000);
      }
    } catch (err: any) {
      setMessage({ text: err.message || "Something went wrong", isError: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "60px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Account settings</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>
        Signed in as {session?.user?.email}
      </p>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
          Current password (required to make any changes)
        </label>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />

        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
          New email (leave blank to keep current)
        </label>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={session?.user?.email || ""}
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />

        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
          New password (leave blank to keep current)
        </label>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />

        {newPassword && (
          <>
            <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
            />
          </>
        )}

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
          {saving ? "Saving..." : "Save changes"}
        </button>
      </form>
    </main>
  );
}
