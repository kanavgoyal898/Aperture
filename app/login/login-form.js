"use client";

import { useState } from "react";

function ApertureMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16.5"/><path d="M18 7.3 24.2 18 18 28.7 11.8 18 18 7.3Z"/><circle cx="18" cy="18" r="4.2"/></svg>;
}

export default function LoginForm() {
  const [mode, setMode] = useState("login");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setError(""); setPending(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form)), signal: AbortSignal.timeout(15_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      window.location.replace("/");
    } catch (submitError) {
      setError(submitError.name === "TimeoutError" ? "The request timed out. Please try again." : submitError.message || "Authentication failed.");
      setPending(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-story"><div className="auth-brand"><span><ApertureMark /></span>Aperture</div><div><p className="kicker">Private market intelligence</p><h1>Your market.<br/>Your frame.</h1><p>Build a personal watchlist and return to the exact companies, funds, and signals that matter to you.</p></div><small>Market data via Yahoo Finance · Informational only</small></section>
    <section className="auth-panel"><form className="auth-form" onSubmit={submit} aria-busy={pending}><p className="kicker">{mode === "login" ? "Welcome back" : "Create your Aperture"}</p><h2>{mode === "login" ? "Sign in" : "Create account"}</h2><p>{mode === "login" ? "Continue to your private market workspace." : "Start a watchlist that belongs only to you."}</p>{mode === "signup" && <label>Name<input name="name" autoComplete="name" minLength="2" maxLength="80" required disabled={pending} placeholder="Your name"/></label>}<label>Email<input name="email" type="email" autoComplete="email" required disabled={pending} placeholder="you@example.com"/></label><label>Password<input name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength="8" required disabled={pending} placeholder="8+ characters"/></label>{error && <div className="auth-error" role="alert">{error}</div>}<button className="auth-submit" disabled={pending}>{pending && <span className="button-spinner" aria-hidden="true"/>}{pending ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}</button><button className="auth-switch" type="button" disabled={pending} onClick={() => { setMode((current) => current === "login" ? "signup" : "login"); setError(""); }}>{mode === "login" ? "New to Aperture? Create an account" : "Already have an account? Sign in"}</button></form></section>
  </main>;
}
