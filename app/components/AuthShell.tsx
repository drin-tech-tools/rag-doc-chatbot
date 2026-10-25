import { ReactNode } from "react";

/** Centers auth content (login, MFA, set-password) on the viewport. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-block">{children}</div>
    </main>
  );
}
