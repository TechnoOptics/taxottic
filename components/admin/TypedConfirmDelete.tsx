"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Typed-confirmation delete button for irreversible super-admin actions.
//
// The submit button stays disabled until the user types `requireText`
// exactly into the input, so a stray click can't nuke an account or a
// company. Defense‑in‑depth: the SERVER ACTIONS also re-check the typed
// value against the live record (this client guard is purely UX).
//
// Pass the server action via the standard <form action={...}> prop.
// Extra hidden fields (id, etc.) go in `hiddenFields`.

import { useState, useTransition } from "react";

export function TypedConfirmDelete({
  formAction,
  hiddenFields,
  inputName,
  requireText,
  label,
  placeholder,
  buttonText,
  destructiveCopy,
}: {
  formAction: (formData: FormData) => Promise<void>;
  hiddenFields: Record<string, string>;
  inputName: string;
  requireText: string;
  label: string;
  placeholder?: string;
  buttonText: string;
  destructiveCopy: string;
}) {
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Case-insensitive match for emails; case-sensitive otherwise, the
  // server is the source of truth and re-validates either way.
  const isEmail = inputName === "confirm_email";
  const match = isEmail
    ? typed.trim().toLowerCase() === requireText.trim().toLowerCase()
    : typed.trim() === requireText.trim();

  return (
    <form
      action={(fd: FormData) => {
        // Server action returns void; wrap in startTransition for the
        // pending UI. Errors thrown server-side surface as page errors;
        // the client guard above keeps casual misclicks from getting here.
        setError(null);
        startTransition(async () => {
          try {
            await formAction(fd);
          } catch (e: any) {
            setError(e?.message ?? "Delete failed.");
          }
        });
      }}
      className="mt-3 grid gap-3"
    >
      {Object.entries(hiddenFields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="grid gap-1.5">
        <span className="text-sm font-medium text-forest-800">{label}</span>
        <input
          name={inputName}
          type="text"
          className="input"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder={placeholder}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </label>
      <p className="text-xs text-ink-muted">{destructiveCopy}</p>
      <button
        type="submit"
        disabled={!match || pending}
        className="rounded-xl px-4 py-2.5 font-semibold text-cream disabled:opacity-50"
        style={{
          background: match && !pending ? "#b91c1c" : "#7f1d1d",
          width: "fit-content",
        }}
      >
        {pending ? "Deleting…" : buttonText}
      </button>
      {error ? (
        <p className="text-sm" style={{ color: "#e6b8a8" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
