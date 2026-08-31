"use client";

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import { Alert, Button, Input, Label } from "@/components/ui";
import type { LoginState } from "@/app/actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function PasswordForm({
  action,
  next,
  label,
  pendingLabel,
  fieldLabel,
  placeholder,
  errorPrefix,
}: {
  action: (state: LoginState, formData: FormData) => Promise<LoginState>;
  next?: string;
  label: string;
  pendingLabel: string;
  fieldLabel: string;
  placeholder: string;
  errorPrefix: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const fieldId = useId();
  const errorId = `${fieldId}-error`;

  return (
    <form action={formAction} className="space-y-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <div>
        <Label htmlFor={fieldId}>{fieldLabel}</Label>
        <Input
          id={fieldId}
          name="password"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          placeholder={placeholder}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? errorId : undefined}
        />
      </div>

      {/* Kept in the DOM so screen readers announce the error when it appears. */}
      <div role="alert" aria-live="assertive">
        {state.error ? (
          <Alert id={errorId} tone="critical">
            <span className="sr-only">{errorPrefix} </span>
            {state.error}
          </Alert>
        ) : null}
      </div>

      <SubmitButton label={label} pendingLabel={pendingLabel} />
    </form>
  );
}
