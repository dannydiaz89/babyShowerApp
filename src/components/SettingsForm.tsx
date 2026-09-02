"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { saveSettings } from "@/app/admin/settings/actions";
import { StorageNotice } from "@/components/StorageNotice";
import type { DriveConnection } from "@/lib/google-drive";
import type { PauseReason, StorageStatus } from "@/lib/photo-wall";
import {
  SETTINGS_TABS,
  type SettingsState,
  type SettingsTab,
} from "@/lib/settings-tabs";
import {
  Alert,
  AnchorButton,
  Button,
  FieldsetLabel,
  Hint,
  Checkbox,
  Input,
  DateField,
  DateTimeField,
  Label,
  Modal,
  Overline,
  Select,
  Tab,
  TabList,
  IconButton,
  Textarea,
  TrashIcon,
  cardClass,
} from "@/components/ui";
import {
  PHOTO_STORAGE_OPTIONS,
  PHOTO_WALL_MODES,
  REGISTRY_ACCENTS,
  type Localized,
  type Registry,
  type Settings,
} from "@/lib/defaults";
import { fill } from "@/lib/i18n/text";
import { MAX_MEAL_LABEL, MAX_MEAL_LABELS } from "@/lib/meals";
import type { Dictionary } from "@/lib/i18n/dictionaries";
import type { Locale } from "@/lib/i18n/text";

/* ------------------------------------------------------------------ fields */

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Text({
  name,
  label,
  hint,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  hint?: string;
  defaultValue?: string;
  type?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        aria-describedby={hintId}
      />
      {hint ? <Hint id={hintId}>{hint}</Hint> : null}
    </div>
  );
}

/**
 * Grow a textarea to fit what's already in it, once when it mounts.
 *
 * Without this a one-row field silently clips saved text that wraps. The
 * callback identity is stable so React only runs it on mount — a later manual
 * drag is never overridden.
 */
function useFitToContent() {
  return useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
}

/**
 * The English/Spanish input pair. Every bilingual field in Settings renders
 * this one component, so the two columns can't end up looking different from
 * each other in different sections.
 *
 * Always a textarea, even for one-line copy: it starts at the height the text
 * needs and the host can drag it taller when what they're writing runs long.
 */
function LocalePair({
  name,
  value,
  t,
  rows = 1,
  maxLength,
  className = "",
}: {
  name: string;
  value: Localized;
  t: Dictionary;
  /** Starting height in lines. Grows by dragging regardless. */
  rows?: number;
  /** Set where the stored value has a hard limit, so the field cannot exceed it. */
  maxLength?: number;
  className?: string;
}) {
  const id = useId();
  const fit = useFitToContent();

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${className}`}>
      <div>
        <label htmlFor={`${id}-en`} className="mb-1 block text-xs text-ink-muted">
          {t.settings.english}
        </label>
        <Textarea
          ref={fit}
          id={`${id}-en`}
          name={`${name}.en`}
          defaultValue={value.en}
          rows={rows}
          maxLength={maxLength}
        />
      </div>
      <div>
        <label htmlFor={`${id}-es`} className="mb-1 block text-xs text-ink-muted">
          {t.settings.spanish}
        </label>
        <Textarea
          ref={fit}
          id={`${id}-es`}
          name={`${name}.es`}
          defaultValue={value.es}
          rows={rows}
          maxLength={maxLength}
        />
      </div>
    </div>
  );
}

/** A named bilingual field: the section label plus the pair beneath it. */
function LocalizedText({
  name,
  label,
  value,
  t,
  rows = 1,
}: {
  name: string;
  label: string;
  value: Localized;
  t: Dictionary;
  rows?: number;
}) {
  return (
    <fieldset>
      <FieldsetLabel>{label}</FieldsetLabel>
      <LocalePair name={name} value={value} t={t} rows={rows} />
    </fieldset>
  );
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        name={name}
        defaultChecked={defaultChecked}
        aria-describedby={hintId}
        className="mt-0.5"
      />
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- form */

/** One panel is mounted at a time, so one id serves every tab. */
const panelId = "settings-panel";

/**
 * Each tab's fields in their own form, so Save applies to that tab alone.
 *
 * Defined at module level on purpose: a component declared inside SettingsForm
 * would be a new type on every render, and React would remount the whole form
 * — losing focus and resetting every uncontrolled input mid-typing.
 */
function Panel({
  formAction,
  panelId,
  tab,
  label,
  dirty,
  state,
  t,
  onDirty,
  children,
}: {
  formAction: (formData: FormData) => void;
  panelId: string;
  tab: SettingsTab;
  label: string;
  dirty: boolean;
  state: SettingsState;
  t: Dictionary;
  onDirty: () => void;
  children: React.ReactNode;
}) {
  const forThisTab = state.tab === tab;

  return (
    <form
      action={formAction}
      id={panelId}
      aria-label={label}
      onInput={onDirty}
      onChange={onDirty}
      className={`${cardClass} space-y-6 px-6 py-6`}
    >
      <input type="hidden" name="tab" value={tab} />

      <div role="status" aria-live="polite">
        {forThisTab && state.message ? (
          <Alert tone={state.status === "saved" ? "positive" : "critical"}>
            {state.message}
          </Alert>
        ) : null}
        {forThisTab && state.passwordMessage ? (
          <Alert tone={state.passwordOk ? "positive" : "critical"}>
            {state.passwordMessage}
          </Alert>
        ) : null}
      </div>

      {children}

      <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
        {dirty ? (
          <span className="text-xs text-danger">{t.settings.unsavedBadge}</span>
        ) : null}
        <SaveButton label={t.settings.save} pendingLabel={t.settings.saving} />
      </div>
    </form>
  );
}

/** What the Photos tab shows about Google Drive. Read on the server; never the token. */
export type DrivePanel = {
  /** GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. */
  configured: boolean;
  connection: DriveConnection | null;
  /** Where the storage stands, for the meter and the pause notice. */
  status: StorageStatus;
  paused: PauseReason | null;
  /** The site's storage cap, formatted. */
  capLabel: string;
  locale: string;
  /** Outcome of a connect or disconnect the host just came back from. */
  notice: { ok: boolean; text: string } | null;
  /** The event date, formatted, for the auto-open hint. */
  eventDate: string;
  /** The preset closing time, a week after the event, shown when nothing is set. */
  defaultCloses: string;
};

export function SettingsForm({
  settings,
  t,
  locale,
  hasStoredPassword,
  drive,
  initialTab = "event",
}: {
  settings: Settings;
  t: Dictionary;
  locale: Locale;
  hasStoredPassword: boolean;
  drive: DrivePanel;
  initialTab?: SettingsTab;
}) {
  const [state, formAction] = useActionState<SettingsState, FormData>(saveSettings, {
    status: "idle",
  });

  const router = useRouter();
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [dirty, setDirty] = useState(false);
  const [pendingTab, setPendingTab] = useState<SettingsTab | null>(null);
  /** What to do if the host chooses "discard" — leave, rather than switch tab. */
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  // Set while carrying out a discarded navigation, so the guard below lets the
  // second attempt through instead of catching it again.
  const leavingRef = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Rows are keyed so removing one doesn't remount the others.
  const [registries, setRegistries] = useState(() =>
    settings.registries.map((r, i) => ({ key: `r${i}`, value: r }))
  );
  const [meals, setMeals] = useState(() =>
    settings.mealOptions.map((m, i) => ({ key: `m${i}`, value: m }))
  );
  const [nextKey, setNextKey] = useState(1000);
  const [deadline, setDeadline] = useState(settings.rsvpDeadlineISO);
  /*
   * The closing-time field keeps its own date and time state, so "back to
   * the preset" remounts it with the preset as its starting value rather
   * than reaching into the two halves.
   */
  const [closesKey, setClosesKey] = useState(0);

  // Dates and times are rendered with an explicit locale so the server and the
  // browser format them identically.
  const intlLocale = locale === "es" ? "es-MX" : "en-US";
  const dateLabels = {
    open: t.settings.pickDate,
    clear: t.settings.clearDate,
    today: t.settings.todayDate,
    previousMonth: t.settings.previousMonth,
    nextMonth: t.settings.nextMonth,
    chooseMonth: t.settings.chooseMonth,
    monthHint: t.settings.monthHint,
    invalid: t.settings.invalidDate,
  };
  const timeLabels = {
    open: t.settings.pickTime,
    hours: t.settings.hoursColumn,
    minutes: t.settings.minutesColumn,
    meridiem: t.settings.meridiemColumn,
    invalid: t.settings.invalidTime,
  };

  const TAB_LABELS: Record<SettingsTab, string> = {
    event: t.settings.sectionEvent,
    wording: t.settings.sectionText,
    registries: t.settings.sectionRegistry,
    form: t.settings.sectionForm,
    photos: t.settings.sectionPhotos,
    access: t.settings.sectionAccess,
  };

  const wallModeLabels = {
    auto: [t.settings.wallModeAuto, fill(t.settings.wallModeAutoHint, { date: drive.eventDate })],
    open: [t.settings.wallModeOpen, t.settings.wallModeOpenHint],
  } as const;

  // A save that succeeded means this tab is clean again.
  useEffect(() => {
    if (state.status === "saved" && state.tab === tab) setDirty(false);
  }, [state, tab]);

  // Closing the tab or reloading would lose the same edits a tab switch would.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /*
   * Client-side navigation never unloads the document, so `beforeunload` does
   * not fire for it: the header's Dashboard, View site and brand links, and
   * its sign-out form, would each drop unsaved edits without a word. Caught
   * here at the document rather than by rewiring the header, so any link or
   * form added to an admin page later is covered by the same rule.
   */
  useEffect(() => {
    if (!dirty) return;

    const ask = (leave: () => void) => {
      setPendingTab(null);
      setPendingLeave(() => leave);
      dialogRef.current?.showModal();
    };

    const onClick = (event: MouseEvent) => {
      if (leavingRef.current || event.defaultPrevented) return;
      // Anything that opens elsewhere — new tab, download, modified click —
      // leaves this page as it is.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target;
      const anchor =
        target instanceof Element ? target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

      event.preventDefault();
      ask(() => router.push(`${url.pathname}${url.search}`));
    };

    const onSubmit = (event: SubmitEvent) => {
      if (leavingRef.current) return;
      const form = event.target;
      // The settings form itself is how edits are saved, not lost.
      if (!(form instanceof HTMLFormElement) || form.id === panelId) return;

      event.preventDefault();
      ask(() => form.requestSubmit());
    };

    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [dirty, router]);

  function requestTab(next: SettingsTab) {
    if (next === tab) return;
    if (dirty) {
      setPendingTab(next);
      dialogRef.current?.showModal();
      return;
    }
    setTab(next);
  }

  function discardAndSwitch() {
    // Row edits live in state, so they have to be rolled back by hand;
    // the plain fields reset on their own when the panel unmounts.
    setRegistries(settings.registries.map((r, i) => ({ key: `r${i}`, value: r })));
    setMeals(settings.mealOptions.map((m, i) => ({ key: `m${i}`, value: m })));
    setDirty(false);
    if (pendingTab) setTab(pendingTab);
    setPendingTab(null);
    dialogRef.current?.close();

    if (pendingLeave) {
      // The listener is removed by its own cleanup, which has not run yet.
      leavingRef.current = true;
      pendingLeave();
      setPendingLeave(null);
    }
  }

  function stay() {
    setPendingTab(null);
    setPendingLeave(null);
    dialogRef.current?.close();
  }

  function addRegistry() {
    const blank: Registry = {
      name: "",
      url: "",
      description: { en: "", es: "" },
      accent: "sage",
    };
    setRegistries((rows) => [...rows, { key: `r${nextKey}`, value: blank }]);
    setNextKey((n) => n + 1);
    setDirty(true);
  }

  function addMeal() {
    setMeals((rows) => [...rows, { key: `m${nextKey}`, value: { en: "", es: "" } }]);
    setNextKey((n) => n + 1);
    setDirty(true);
  }

  return (
    <div className="space-y-5">
      <TabList label={t.settings.tabsLabel}>
        {SETTINGS_TABS.map((name) => {
          const active = name === tab;
          return (
            <Tab
              key={name}
              selected={active}
              onClick={() => requestTab(name)}
              aria-controls={active ? panelId : undefined}
            >
              {TAB_LABELS[name]}
              {active && dirty ? (
                <span aria-hidden="true" className="ml-1.5 text-danger">
                  &bull;
                </span>
              ) : null}
            </Tab>
          );
        })}
      </TabList>

      {tab === "event" ? (
        <Panel
          formAction={formAction}
          panelId={panelId}
          tab={tab}
          label={TAB_LABELS[tab]}
          dirty={dirty}
          state={state}
          t={t}
          onDirty={() => setDirty(true)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Text
              name="babyName"
              label={t.settings.babyName}
              hint={t.settings.babyNameHint}
              defaultValue={settings.babyName}
            />
            <Text name="honorees" label={t.settings.honorees} defaultValue={settings.honorees} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text name="venueName" label={t.settings.venueName} defaultValue={settings.venueName} />
            <Text name="address" label={t.settings.address} defaultValue={settings.address} />
          </div>
          <Text
            name="mapsQuery"
            label={t.settings.mapsQuery}
            hint={t.settings.mapsQueryHint}
            defaultValue={settings.mapsQuery}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <DateTimeField
              id="settings-start"
              name="startISO"
              legend={t.settings.start}
              value={settings.startISO}
              locale={intlLocale}
              dateLabels={dateLabels}
              timeLabels={timeLabels}
              dateFieldLabel={t.settings.dateInput}
              timeFieldLabel={t.settings.timeInput}
            />
            <DateTimeField
              id="settings-end"
              name="endISO"
              legend={t.settings.end}
              value={settings.endISO}
              locale={intlLocale}
              dateLabels={dateLabels}
              timeLabels={timeLabels}
              dateFieldLabel={t.settings.dateInput}
              timeFieldLabel={t.settings.timeInput}
            />
          </div>

          <div className="sm:max-w-xs">
            <Label htmlFor="settings-deadline">{t.settings.deadline}</Label>
            <DateField
              id="settings-deadline"
              name="rsvpDeadlineISO"
              value={deadline}
              onChange={setDeadline}
              locale={intlLocale}
              labels={dateLabels}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text
              name="contactName"
              label={t.settings.contactName}
              defaultValue={settings.contactName}
            />
            <Text
              name="contactEmail"
              label={t.settings.contactEmail}
              type="email"
              defaultValue={settings.contactEmail}
            />
          </div>
          <Text
            name="giftShippingAddress"
            label={t.settings.giftShipping}
            defaultValue={settings.giftShippingAddress}
          />
        </Panel>
      ) : null}

      {tab === "wording" ? (
        <Panel
          formAction={formAction}
          panelId={panelId}
          tab={tab}
          label={TAB_LABELS[tab]}
          dirty={dirty}
          state={state}
          t={t}
          onDirty={() => setDirty(true)}
        >
          <LocalizedText name="tagline" label={t.settings.tagline} value={settings.tagline} t={t} />
          <LocalizedText
            name="dressCode"
            label={t.settings.dressCode}
            value={settings.dressCode}
            t={t}
          />
          <LocalizedText
            name="notes"
            label={t.settings.notes}
            value={settings.notes}
            t={t}
            rows={3}
          />
        </Panel>
      ) : null}

      {tab === "registries" ? (
        <Panel
          formAction={formAction}
          panelId={panelId}
          tab={tab}
          label={TAB_LABELS[tab]}
          dirty={dirty}
          state={state}
          t={t}
          onDirty={() => setDirty(true)}
        >
          <ul className="space-y-5">
            {registries.map((row, index) => (
              <li key={row.key} className="rounded-lg border border-border p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-ink">
                    {t.settings.registryPosition.replace("{n}", String(index + 1))}
                  </h2>
                  <IconButton
                    label={t.settings.removeRegistry}
                    onClick={() => {
                      setRegistries((rows) => rows.filter((r) => r.key !== row.key));
                      setDirty(true);
                    }}
                  >
                    <TrashIcon />
                  </IconButton>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Text
                    name={`registries.${index}.name`}
                    label={t.settings.registryName}
                    defaultValue={row.value.name}
                  />
                  <Text
                    name={`registries.${index}.url`}
                    label={t.settings.registryUrl}
                    type="url"
                    defaultValue={row.value.url}
                  />
                </div>
                <div className="mt-3">
                  <LocalizedText
                    name={`registries.${index}.description`}
                    label={t.settings.registryDescription}
                    value={row.value.description}
                    t={t}
                  />
                </div>
                <div className="mt-3">
                  <Label htmlFor={`${row.key}-accent`}>
                    {t.settings.registryColor}
                  </Label>
                  <Select
                    id={`${row.key}-accent`}
                    name={`registries.${index}.accent`}
                    defaultValue={row.value.accent}
                  >
                    {REGISTRY_ACCENTS.map((accent) => (
                      <option key={accent} value={accent}>
                        {accent}
                      </option>
                    ))}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" onClick={addRegistry}>
            {t.settings.addRegistry}
          </Button>
        </Panel>
      ) : null}

      {tab === "form" ? (
        <Panel
          formAction={formAction}
          panelId={panelId}
          tab={tab}
          label={TAB_LABELS[tab]}
          dirty={dirty}
          state={state}
          t={t}
          onDirty={() => setDirty(true)}
        >
          <Toggle
            name="askMeal"
            label={t.settings.askMeal}
            hint={t.settings.askMealHint}
            defaultChecked={settings.askMeal}
          />
          <Toggle
            name="allowKids"
            label={t.settings.allowKids}
            hint={t.settings.allowKidsHint}
            defaultChecked={settings.allowKids}
          />
          <Toggle
            name="collectPhone"
            label={t.settings.collectPhone}
            hint={t.settings.collectPhoneHint}
            defaultChecked={settings.collectPhone}
          />

          <div className="border-t border-border pt-5">
            <Overline as="h2" className="mb-3">{t.settings.mealOptions}</Overline>
            <ul className="space-y-3">
              {meals.map((row, index) => (
                <li key={row.key} className="flex items-start gap-3">
                  <LocalePair
                    name={`mealOptions.${index}`}
                    value={row.value}
                    t={t}
                    maxLength={MAX_MEAL_LABEL}
                    className="flex-1"
                  />
                  {/* An empty label of the same size pushes the button down to
                      the top edge of the inputs, so the two line up without a
                      hard-coded offset. */}
                  <div className="shrink-0">
                    <span aria-hidden="true" className="mb-1 block text-xs">
                      &nbsp;
                    </span>
                    <IconButton
                      label={t.settings.removeMealOption}
                      onClick={() => {
                        setMeals((rows) => rows.filter((m) => m.key !== row.key));
                        setDirty(true);
                      }}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
            {/*
              * Stops at the number the catering tally can hold. The save
              * action checks the real rule — an option counts once per
              * language — and says so if a bilingual menu goes over.
              */}
            <Button
              type="button"
              variant="secondary"
              onClick={addMeal}
              disabled={meals.length >= MAX_MEAL_LABELS}
              className="mt-3"
            >
              {t.settings.addMealOption}
            </Button>
          </div>
        </Panel>
      ) : null}

      {tab === "photos" ? (
        <>
          <Panel
            formAction={formAction}
            panelId={panelId}
            tab={tab}
            label={TAB_LABELS[tab]}
            dirty={dirty}
            state={state}
            t={t}
            onDirty={() => setDirty(true)}
          >
            <fieldset>
              <FieldsetLabel>{t.settings.storageTitle}</FieldsetLabel>
              <div className="space-y-3">
                {PHOTO_STORAGE_OPTIONS.map((option) => (
                  <label key={option} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="photoStorage"
                      value={option}
                      defaultChecked={settings.photoStorage === option}
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {option === "site" ? t.settings.storageSite : t.settings.storageDrive}
                      </span>
                      <span className="block text-xs text-ink-muted">
                        {option === "site"
                          ? fill(t.settings.storageSiteHint, { cap: drive.capLabel })
                          : t.settings.storageDriveHint}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <Hint>{t.settings.storageSwitchNote}</Hint>
            </fieldset>

            <fieldset className="border-t border-border pt-5">
              <FieldsetLabel>{t.settings.wallMode}</FieldsetLabel>
              <div className="space-y-3">
                {PHOTO_WALL_MODES.map((mode) => (
                  <label key={mode} className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="photoWall"
                      value={mode}
                      defaultChecked={settings.photoWall === mode}
                      className="mt-1 h-4 w-4 accent-accent"
                    />
                    <span>
                      <span className="block text-sm font-medium text-ink">
                        {wallModeLabels[mode][0]}
                      </span>
                      <span className="block text-xs text-ink-muted">{wallModeLabels[mode][1]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="border-t border-border pt-5">
              <DateTimeField
                key={closesKey}
                id="settings-photo-closes"
                name="photoWallClosesISO"
                legend={t.settings.wallCloses}
                value={closesKey === 0 ? settings.photoWallClosesISO || drive.defaultCloses : drive.defaultCloses}
                locale={intlLocale}
                dateLabels={dateLabels}
                timeLabels={timeLabels}
                dateFieldLabel={t.settings.dateInput}
                timeFieldLabel={t.settings.timeInput}
              />
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <Hint className="mt-0">{t.settings.wallClosesHint}</Hint>
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setClosesKey((k) => k + 1);
                    setDirty(true);
                  }}
                  className="shrink-0 px-0"
                >
                  {t.settings.wallClosesReset}
                </Button>
              </div>
            </div>
          </Panel>

          {/*
            * Outside the panel's form on purpose: connecting is a link to
            * Google and disconnecting is its own POST, and neither is a
            * setting to be saved. A form inside a form is not HTML.
            */}
          <section aria-labelledby="drive-title" className={`${cardClass} space-y-4 px-6 py-6`}>
            <div>
              <Overline as="h2" id="drive-title" className="mb-1.5">
                {t.settings.driveTitle}
              </Overline>
              <p className="max-w-prose text-sm text-ink-muted">{t.settings.driveIntro}</p>
            </div>

            {drive.notice ? (
              <Alert tone={drive.notice.ok ? "positive" : "critical"} role="status">
                {drive.notice.text}
              </Alert>
            ) : null}

            <StorageNotice
              status={drive.status}
              paused={drive.paused}
              connection={drive.connection}
              t={t}
              locale={drive.locale}
              withActions
            />

            {!drive.configured ? (
              <p className="text-sm text-ink">{t.settings.driveUnconfigured}</p>
            ) : drive.connection ? (
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  {fill(t.settings.driveConnected, { account: drive.connection.account })}
                  {" · "}
                  <a
                    href={drive.connection.folderUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent underline underline-offset-4"
                  >
                    {t.settings.driveFolder}
                    <span className="sr-only"> ({t.registry.opensInNewTab})</span>
                  </a>
                </p>
                {drive.connection.health === "ok" && !drive.paused ? (
                  <p className="text-xs text-success">{t.settings.driveHealthy}</p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <form method="post" action="/api/google/check">
                    <Button type="submit" variant="secondary">
                      {t.settings.driveCheck}
                    </Button>
                  </form>
                  <AnchorButton href="/api/google/start" variant="secondary">
                    {t.settings.driveReconnect}
                  </AnchorButton>
                  <form method="post" action="/api/google/disconnect">
                    <Button type="submit" variant="quiet">
                      {t.settings.driveDisconnect}
                    </Button>
                  </form>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-ink">{t.settings.driveNotConnected}</p>
                <AnchorButton href="/api/google/start" variant="primary">
                  {t.settings.driveConnect}
                </AnchorButton>
              </div>
            )}
          </section>
        </>
      ) : null}

      {tab === "access" ? (
        <Panel
          formAction={formAction}
          panelId={panelId}
          tab={tab}
          label={TAB_LABELS[tab]}
          dirty={dirty}
          state={state}
          t={t}
          onDirty={() => setDirty(true)}
        >
          <p className="text-sm text-ink-muted">
            {hasStoredPassword
              ? t.settings.guestPasswordSet
              : t.settings.guestPasswordEnv}
          </p>
          <Text
            name="guestPassword"
            label={t.settings.guestPassword}
            hint={t.settings.guestPasswordHint}
            type="password"
          />
        </Panel>
      ) : null}

      {/*
        * Dismissing this dialog any way — close button, backdrop, Escape —
        * means "stay on this tab", which is the safe answer: nothing is lost.
        */}
      <Modal
        ref={dialogRef}
        titleId="unsaved-title"
        title={t.settings.unsavedTitle}
        closeLabel={t.common.close}
        onClose={() => {
          setPendingTab(null);
          setPendingLeave(null);
        }}
        className="max-w-md"
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          {t.settings.unsavedBody.replace("{tab}", TAB_LABELS[tab])}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={discardAndSwitch}>
            {t.settings.discardChanges}
          </Button>
          <Button type="button" onClick={stay} autoFocus>
            {t.settings.stayHere}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
