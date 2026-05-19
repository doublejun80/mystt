"use client";

import { useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/v1/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        setError("이메일과 비밀번호를 다시 확인해 주세요.");
        return;
      }

      const next = searchParams.get("next") || "/";
      window.location.assign(next.startsWith("/") ? next : "/");
    } catch {
      setError("로그인 요청을 완료하지 못했습니다.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="authForm" onSubmit={submitLogin}>
      <label className="fieldLabel" htmlFor="owner-email">
        Email
      </label>
      <input
        id="owner-email"
        className="authInput"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
      />
      <label className="fieldLabel" htmlFor="owner-password">
        Password
      </label>
      <input
        id="owner-password"
        className="authInput"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="접근 비밀번호"
      />
      {error ? <p className="authError">{error}</p> : null}
      <button
        className="ghostButton authButton"
        type="submit"
        disabled={isSubmitting || !email || !password}
      >
        {isSubmitting ? "확인 중" : "들어가기"}
      </button>
    </form>
  );
}
