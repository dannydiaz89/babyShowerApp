"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { submitRsvp, type RsvpState } from "@/app/rsvp/actions";
import { Moon } from "@/components/Moon";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  DisplayTitle,
  FieldError,
  FieldsetLabel,
  Input,
  Label,
  Select,
  Textarea,
  cardClass,
} from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";

export type RsvpFormProps = {
  t: Dictionary;
  honorees: string;
  eventDate: string;
  mealOptions: string[];
  askMeal: boolean;
  allowKids: boolean;
  collectPhone: boolean;
};

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Confirmation({
  state,
  t,
  eventDate,
}: {
  state: RsvpState;
  t: Dictionary;
  eventDate: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the confirmation so screen reader users are told what
  // happened, instead of being left on a form that vanished.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const body = state.attending
    ? t.rsvp.successAttendingBody.replace("{date}", eventDate)
    : t.rsvp.successDeclinedBody;

  return (
    <Card className="px-7 py-12 text-center" role="status">
      <Moon className="mx-auto h-10 w-10 text-accent" />
      <DisplayTitle as="h2" ref={headingRef} tabIndex={-1} className="mt-5 text-3xl">
        {state.attending ? t.rsvp.successAttending : t.rsvp.successDeclined}
      </DisplayTitle>
      <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-muted">{body}</p>
      {state.updated ? (
        <p className="mt-3 text-xs text-ink-muted">{t.rsvp.replacedEarlier}</p>
      ) : null}

      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <ButtonLink href="/registry" variant="primary" className="w-full sm:w-auto">
          {t.rsvp.viewRegistry}
        </ButtonLink>
        <Button
          type="button"
          variant="secondary"
          onClick={() => window.location.reload()}
          className="w-full sm:w-auto"
        >
          {t.rsvp.changeAnswer}
        </Button>
      </div>
    </Card>
  );
}

export function RsvpForm({
  t,
  honorees,
  eventDate,
  mealOptions,
  askMeal,
  allowKids,
  collectPhone,
}: RsvpFormProps) {
  const [state, formAction] = useActionState<RsvpState, FormData>(submitRsvp, {
    status: "idle",
  });
  const [attending, setAttending] = useState(true);
  const summaryRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  const errors = state.errors ?? {};
  const errorEntries = Object.entries(errors);

  /*
   * React 19 resets an uncontrolled form as soon as its action returns, which
   * would wipe everything a guest typed the moment we reject a submission.
   * Put their answers back so they only have to fix the one field we flagged.
   */
  useEffect(() => {
    const values = state.values;
    const form = formRef.current;
    if (!values || !form) return;

    for (const [field, value] of Object.entries(values)) {
      const el = form.elements.namedItem(field);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.value = value;
      } else if (el instanceof HTMLSelectElement && value) {
        el.value = value;
      }
    }
  }, [state]);

  // Send focus to the error summary so the problem is announced and reachable.
  useEffect(() => {
    if (errorEntries.length > 0) summaryRef.current?.focus();
  }, [state, errorEntries.length]);

  if (state.status === "success") {
    return <Confirmation state={state} t={t} eventDate={eventDate} />;
  }

  const fieldId = (name: string) => `${id}-${name}`;
  const errorId = (name: string) => `${id}-${name}-error`;
  const describedBy = (name: string) => (errors[name] ? errorId(name) : undefined);
  const contactHintId = `${id}-contact-hint`;

  const optional = (
    <span className="font-normal normal-case tracking-normal">{t.rsvp.optional}</span>
  );

  return (
    <form
      ref={formRef}
      action={formAction}
      className={`${cardClass} space-y-6 px-6 py-7 sm:px-8`}
      noValidate
    >
      {/* One place naming every problem, each linked to the field it belongs to. */}
      <div ref={summaryRef} tabIndex={-1} role="alert" aria-live="assertive">
        {errorEntries.length > 0 ? (
          <Alert tone="critical">
            <p className="font-semibold">{t.rsvp.errorsHeading}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {errorEntries.map(([name, message]) => (
                <li key={name}>
                  <a href={`#${fieldId(name)}`} className="underline underline-offset-2">
                    {message}
                  </a>
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
        {state.message ? <Alert tone="critical">{state.message}</Alert> : null}
      </div>

      <fieldset>
        <FieldsetLabel>{t.rsvp.attendingQuestion}</FieldsetLabel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { value: "yes", label: t.rsvp.accept },
            { value: "no", label: t.rsvp.decline },
          ].map((option) => {
            const selected = attending === (option.value === "yes");
            return (
              <label
                key={option.value}
                className={`cursor-pointer rounded-md border px-4 py-3.5 text-center text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                  selected
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-border bg-surface text-ink-muted hover:border-border-strong"
                }`}
              >
                <input
                  type="radio"
                  name="attending"
                  value={option.value}
                  checked={selected}
                  onChange={() => setAttending(option.value === "yes")}
                  className="sr-only"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor={fieldId("name")}>{t.rsvp.name}</Label>
          <Input
            id={fieldId("name")}
            name="name"
            required
            autoComplete="name"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describedBy("name")}
            placeholder={t.rsvp.namePlaceholder}
          />
          <FieldError id={errorId("name")} prefix={t.common.errorPrefix}>
            {errors.name}
          </FieldError>
        </div>
        <div>
          <Label htmlFor={fieldId("email")}>
            {t.rsvp.email} {collectPhone ? optional : null}
          </Label>
          <Input
            id={fieldId("email")}
            name="email"
            type="email"
            required={!collectPhone}
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describedBy("email")}
            placeholder={t.rsvp.emailPlaceholder}
          />
          <FieldError id={errorId("email")} prefix={t.common.errorPrefix}>
            {errors.email}
          </FieldError>
        </div>
      </div>

      {collectPhone ? (
        <div>
          <Label htmlFor={fieldId("phone")}>
            {t.rsvp.phone} {optional}
          </Label>
          <Input
            id={fieldId("phone")}
            name="phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={describedBy("phone") ?? contactHintId}
            placeholder={t.rsvp.phonePlaceholder}
          />
          <FieldError id={errorId("phone")} prefix={t.common.errorPrefix}>
            {errors.phone}
          </FieldError>
          {/* Says plainly that one of the two is enough. */}
          <p id={contactHintId} className="mt-1.5 text-xs text-ink-muted">
            {t.rsvp.contactHint}
          </p>
        </div>
      ) : null}

      {/* Everything below only matters if they're coming. */}
      {attending ? (
        <div className="space-y-6 border-t border-border pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={fieldId("adults")}>
                {t.rsvp.adults}{" "}
                <span className="font-normal normal-case tracking-normal">
                  {t.rsvp.adultsHint}
                </span>
              </Label>
              <Input
                id={fieldId("adults")}
                name="adults"
                type="number"
                inputMode="numeric"
                min={1}
                max={20}
                defaultValue={1}
                aria-invalid={errors.adults ? true : undefined}
                aria-describedby={describedBy("adults")}
              />
              <FieldError id={errorId("adults")} prefix={t.common.errorPrefix}>
                {errors.adults}
              </FieldError>
            </div>
            {allowKids ? (
              <div>
                <Label htmlFor={fieldId("kids")}>{t.rsvp.kids}</Label>
                <Input
                  id={fieldId("kids")}
                  name="kids"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={20}
                  defaultValue={0}
                />
              </div>
            ) : null}
          </div>

          <div>
            <Label htmlFor={fieldId("guestNames")}>
              {t.rsvp.guestNames} {optional}
            </Label>
            <Input
              id={fieldId("guestNames")}
              name="guestNames"
              placeholder={t.rsvp.guestNamesPlaceholder}
            />
          </div>

          {askMeal && mealOptions.length > 0 ? (
            <div>
              <Label htmlFor={fieldId("meal")}>{t.rsvp.meal}</Label>
              <Select id={fieldId("meal")} name="meal" defaultValue={mealOptions[0]}>
                {mealOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}

          <div>
            <Label htmlFor={fieldId("dietaryNotes")}>
              {t.rsvp.dietary} {optional}
            </Label>
            <Input
              id={fieldId("dietaryNotes")}
              name="dietaryNotes"
              placeholder={t.rsvp.dietaryPlaceholder}
            />
          </div>
        </div>
      ) : null}

      <div className="border-t border-border pt-6">
        <Label htmlFor={fieldId("message")}>
          {t.rsvp.message.replace("{names}", honorees)} {optional}
        </Label>
        <Textarea
          id={fieldId("message")}
          name="message"
          rows={3}
          placeholder={t.rsvp.messagePlaceholder}
        />
      </div>

      <div className="space-y-3">
        <SubmitButton label={t.rsvp.submit} pendingLabel={t.rsvp.sending} />
        <p className="text-center text-xs text-ink-muted">{t.rsvp.changeHint}</p>
      </div>
    </form>
  );
}
