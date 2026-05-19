import { Suspense } from "react";

import { LoginForm } from "../../components/login-form";

export default function LoginPage() {
  return (
    <main className="authShell">
      <section className="authPanel">
        <p className="sectionEyebrow">mystt private access</p>
        <h1 className="pageTitle">회의 기록은 잠겨 있습니다.</h1>
        <p className="pageHeaderCopy">
          네가 설정한 이메일과 비밀번호로 로그인하면 이 브라우저에 제한 시간 세션이 저장됩니다.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
