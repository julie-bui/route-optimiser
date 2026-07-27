"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      setError("Invalid email or password");
    } else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "80px auto", padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 20 }}>Sign in</h1>
      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", marginBottom: 12, border: "1px solid #999", borderRadius: 4 }}
        />
        <label style={{ display: "block", fontSize: 13, color: "#666", marginBottom: 4 }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{ width: "100%", padding: "8px 10px", marginBottom: 16, border: "1px solid #999", borderRadius: 4 }}
        />
        {error && <p style={{ color: "#a32d2d", fontSize: 13, marginBottom: 12 }}>{error}</p>}
        <button type="submit" style={{ width: "100%", padding: "10px", background: "#000", color: "#fff", border: "none", borderRadius: 4 }}>
          Sign in
        </button>
      </form>
    </main>
  );
}
