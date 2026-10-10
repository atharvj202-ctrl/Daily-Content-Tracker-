"use client";

import { useActionState } from "react";
import { setupLinkAction, type SetupLinkState } from "./actions";

export function SetupLinkButton({ userId, hasPassword }: { userId: string; hasPassword: boolean }) {
  const [state, action, pending] = useActionState<SetupLinkState, FormData>(setupLinkAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="id" value={userId} />
      <button type="submit" className="secondary" disabled={pending}>
        {hasPassword ? "Create password reset link" : "Create account setup link"}
      </button>
      {state.error && <p className="flash error small" style={{ marginTop: "0.5rem" }}>{state.error}</p>}
      {state.link && (
        <div style={{ marginTop: "0.75rem" }}>
          <p className="small">
            Copy this one-time link and send it to the person directly (e.g. WhatsApp or email). It expires in 72 hours,
            works once, and is not shown again. Creating a new link cancels older ones.
          </p>
          <div className="linkbox">{state.link}</div>
        </div>
      )}
    </form>
  );
}
