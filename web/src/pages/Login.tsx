import { FormEvent, useState } from "react";
import { User, api } from "../api.js";

interface LoginProps {
  onAuthenticated: (user: User) => void;
  initialNotice?: string | null;
}

export default function Login({ onAuthenticated, initialNotice }: LoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(initialNotice ?? null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmitLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await api.login({ email, password });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Login failed.");
        return;
      }
      if (body.status === "verification_required") {
        setPendingUserId(body.userId);
        setPendingEmail(body.email);
        setNotice("We sent a 6-digit verification code to your email. Enter it below to finish signing in.");
      } else {
        onAuthenticated(body.user);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.verifyEmail({ userId: pendingUserId!, code });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Verification failed.");
        return;
      }
      onAuthenticated(body.user);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onResend() {
    setError(null);
    setNotice(null);
    try {
      const res = await api.resendCode(pendingUserId!);
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || "Could not resend code.");
        return;
      }
      setNotice("A new code was sent.");
    } catch {
      setError("Could not reach the server.");
    }
  }

  return (
    <div className="layout" style={{ alignItems: "center", justifyContent: "center", display: "flex" }}>
      <div className="card" style={{ width: 360 }}>
        <h2>{pendingUserId ? "Verify your email" : "Sign in"}</h2>

        {!pendingUserId && (
          <form onSubmit={onSubmitLogin}>
            <div className="form-row">
              <label>Email</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
            </div>
            <div className="form-row">
              <label>Password</label>
              <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {notice && <p style={{ color: "#59636e" }}>{notice}</p>}
            {error && <p style={{ color: "#cf222e" }}>{error}</p>}
            <button className="primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}

        {pendingUserId && (
          <form onSubmit={onSubmitCode}>
            <p style={{ color: "#59636e" }}>
              First-time sign-in for <strong>{pendingEmail}</strong> — verify your email to continue.
            </p>
            <div className="form-row">
              <label>Verification code</label>
              <input
                required
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoFocus
              />
            </div>
            {notice && <p style={{ color: "#1a7f37" }}>{notice}</p>}
            {error && <p style={{ color: "#cf222e" }}>{error}</p>}
            <button className="primary" type="submit" disabled={submitting}>
              {submitting ? "Verifying…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              onClick={onResend}
              style={{ marginLeft: 10, background: "none", border: "none", color: "#59636e", cursor: "pointer" }}
            >
              Resend code
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
