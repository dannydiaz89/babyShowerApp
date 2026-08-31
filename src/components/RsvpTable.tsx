"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteRsvps, mergeRsvps, updateRsvp } from "@/app/admin/dashboard/actions";
import {
  Badge,
  Button,
  Checkbox,
  FieldsetLabel,
  Input,
  Label,
  Modal,
  Select,
  RowMenu,
  cardClass,
} from "@/components/ui";
import { fill } from "@/lib/i18n/text";
import type { Dictionary } from "@/lib/i18n/dictionaries";

import { buildMergePreview, type RsvpRecord } from "@/lib/rsvp";

/**
 * A row plus its dates already rendered to text.
 *
 * Formatting them here would run once on the server and again in the browser,
 * each using its own time zone — different output, and a hydration mismatch
 * for anyone whose phone disagrees with the server. The server formats; this
 * component just prints.
 */
export type RsvpRow = RsvpRecord & {
  receivedLabel: string;
  editedLabel: string | null;
};

function SaveButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function partySummary(adults: number, kids: number, t: Dictionary): string {
  const parts = [
    adults === 1
      ? fill(t.admin.adultCount, { count: adults })
      : fill(t.admin.adultsCount, { count: adults }),
  ];
  if (kids > 0) {
    parts.push(
      kids === 1
        ? fill(t.admin.childCount, { count: kids })
        : fill(t.admin.childrenCount, { count: kids })
    );
  }
  return parts.join(", ");
}

export function RsvpTable({
  rsvps,
  t,
  mealOptions,
  askMeal,
}: {
  rsvps: RsvpRow[];
  t: Dictionary;
  mealOptions: string[];
  askMeal: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [keepId, setKeepId] = useState<string | null>(null);
  const [mergeStep, setMergeStep] = useState<"choose" | "review">("choose");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<RsvpRow | null>(null);
  const [editAttending, setEditAttending] = useState(true);

  /** Rows queued for deletion, held until the confirmation is answered. */
  const [pendingDelete, setPendingDelete] = useState<RsvpRow[]>([]);
  const confirmRef = useRef<HTMLDialogElement>(null);

  function askDelete(rows: RsvpRow[]) {
    if (rows.length === 0) return;
    setPendingDelete(rows);
    confirmRef.current?.showModal();
  }

  function openDetail(row: RsvpRow) {
    setEditing(row);
    setEditAttending(row.attending);
    detailRef.current?.showModal();
  }

  const chosen = useMemo(
    () => rsvps.filter((r) => selected.includes(r._id)),
    [rsvps, selected]
  );

  /*
   * When the server sends back a changed list, drop any selection pointing at
   * rows that no longer exist and close whichever dialog was acting on them.
   * Doing this here rather than in a click handler means the forms are still
   * intact at the moment they are submitted.
   */
  useEffect(() => {
    setSelected((ids) => ids.filter((id) => rsvps.some((r) => r._id === id)));
    dialogRef.current?.close();
    confirmRef.current?.close();
    /*
     * The detail dialog too. It holds a snapshot of the row taken when it was
     * opened, so leaving it up after a save shows the values as they were
     * before the edit — the record looks unchanged even though it saved.
     */
    detailRef.current?.close();
  }, [rsvps]);

  function toggle(id: string) {
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  const allSelected = rsvps.length > 0 && selected.length === rsvps.length;
  const someSelected = selected.length > 0 && !allSelected;

  // "Some but not all" has no HTML attribute — it has to be set on the node.
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  function openMerge() {
    setKeepId(chosen[0]?._id ?? null);
    setMergeStep("choose");
    dialogRef.current?.showModal();
  }

  /**
   * The combined record as it stands. Recomputed when the kept row changes, so
   * the review step always reflects the current choice.
   */
  const keptRow = chosen.find((r) => r._id === keepId) ?? chosen[0] ?? null;
  const preview = keptRow
    ? buildMergePreview(
        keptRow,
        chosen.filter((r) => r._id !== keptRow._id)
      )
    : null;

  const [reviewAttending, setReviewAttending] = useState(true);
  useEffect(() => {
    if (preview) setReviewAttending(preview.attending);
    // Only when the kept row changes, not on every render of the preview.
  }, [keepId, mergeStep]); // eslint-disable-line react-hooks/exhaustive-deps

  if (rsvps.length === 0) {
    return (
      <div className={`${cardClass} px-6 py-16 text-center text-sm text-ink-muted`}>
        {t.admin.noRsvps}
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex min-h-9 flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-ink-muted">
          {selected.length > 0
            ? fill(t.admin.selectedCount, { count: selected.length })
            : t.admin.mergeHint}
        </p>
        {selected.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {selected.length >= 2 ? (
              <Button type="button" size="sm" onClick={openMerge}>
                {fill(t.admin.mergeSelected, { count: selected.length })}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => askDelete(chosen)}
            >
              {fill(t.admin.deleteSelected, { count: selected.length })}
            </Button>
          </div>
        ) : null}
      </div>

      <div className={`${cardClass} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[50rem] text-left text-sm">
            <caption className="sr-only">{t.admin.dashboard}</caption>
            <thead className="bg-accent-soft/60">
              <tr className="border-b border-border text-sm text-ink-muted">
                <th scope="col" className="w-12 px-4 py-3.5">
                  <Checkbox
                    ref={selectAllRef}
                    checked={allSelected}
                    /* Anything selected — all of them or a partial mix — means
                       this control clears. Only an empty table header selects
                       all. Selecting all from the dash is the surprising
                       reading: the dash says "some are on", so the obvious
                       undo is to turn them off. */
                    onChange={() =>
                      setSelected(selected.length > 0 ? [] : rsvps.map((r) => r._id))
                    }
                    aria-label={
                      selected.length > 0 ? t.admin.clearSelection : t.admin.selectAll
                    }
                    className="h-[1.15rem] w-[1.15rem] align-middle"
                  />
                </th>
                <th scope="col" className="px-5 py-3.5 font-normal">{t.admin.colGuest}</th>
                <th scope="col" className="px-5 py-3.5 font-normal">{t.admin.colReply}</th>
                <th scope="col" className="px-5 py-3.5 font-normal">{t.admin.colParty}</th>
                <th scope="col" className="px-5 py-3.5 font-normal">{t.admin.colMeal}</th>
                <th scope="col" className="px-5 py-3.5 font-normal">{t.admin.colReceived}</th>
                <th scope="col" className="px-5 py-3.5">
                  <span className="sr-only">{t.admin.colActions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rsvps.map((rsvp) => (
                <tr
                  key={rsvp._id}
                  onClick={(event) => {
                    /*
                     * A row is a shortcut for mouse users, not the only way in:
                     * the pencil button in each row is the keyboard- and
                     * screen-reader-accessible path to the same dialog. Clicks
                     * on the controls inside the row belong to those controls.
                     */
                    if (
                      (event.target as HTMLElement).closest(
                        "button, input, label, a, select, textarea"
                      )
                    ) {
                      return;
                    }
                    openDetail(rsvp);
                  }}
                  className={`cursor-pointer border-b border-border/60 align-top transition-colors ${
                    selected.includes(rsvp._id)
                      ? "bg-accent-soft/40"
                      : "hover:bg-surface-sunken/50"
                  }`}
                >
                  <td className="px-4 py-4">
                    <Checkbox
                      checked={selected.includes(rsvp._id)}
                      onChange={() => toggle(rsvp._id)}
                      aria-label={fill(t.admin.select, { name: rsvp.name })}
                      className="mt-1 h-[1.15rem] w-[1.15rem]"
                    />
                  </td>
                  <th scope="row" className="px-5 py-4 text-left font-medium">
                    <span className="text-ink">{rsvp.name}</span>
                    {rsvp.email ? (
                      <span className="block text-xs font-normal text-ink-muted">
                        {rsvp.email}
                      </span>
                    ) : null}
                    {rsvp.phone ? (
                      <span className="block text-xs font-normal text-ink-muted">
                        {rsvp.phone}
                      </span>
                    ) : null}
                    {rsvp.message ? (
                      <span className="mt-1.5 block max-w-xs whitespace-pre-line text-xs font-normal italic text-ink-muted">
                        &ldquo;{rsvp.message}&rdquo;
                      </span>
                    ) : null}
                  </th>
                  <td className="px-5 py-4">
                    <Badge tone={rsvp.attending ? "positive" : "critical"}>
                      {rsvp.attending ? t.admin.replyAttending : t.admin.replyDeclined}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    {rsvp.attending ? (
                      <>
                        <p className="text-ink">{partySummary(rsvp.adults, rsvp.kids, t)}</p>
                        {rsvp.guestNames ? (
                          <p className="mt-0.5 max-w-[14rem] text-xs text-ink-muted">
                            {rsvp.guestNames}
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-ink-muted">&mdash;</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    {rsvp.meal ? <p className="text-ink">{rsvp.meal}</p> : null}
                    {rsvp.dietaryNotes ? (
                      <p className="mt-0.5 max-w-[14rem] text-xs text-danger">
                        {rsvp.dietaryNotes}
                      </p>
                    ) : null}
                    {!rsvp.meal && !rsvp.dietaryNotes ? (
                      <span className="text-ink-muted">&mdash;</span>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-xs text-ink-muted">
                    {rsvp.receivedLabel}
                    {rsvp.editedLabel ? (
                      <span className="block">{rsvp.editedLabel}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-4">
                    <div className="flex justify-end">
                      <RowMenu
                        label={fill(t.admin.rowActions, { name: rsvp.name })}
                        items={[
                          {
                            label: t.admin.editAction,
                            onSelect: () => openDetail(rsvp),
                          },
                          {
                            label: t.admin.deleteAction,
                            tone: "danger",
                            onSelect: () => askDelete([rsvp]),
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deleting is the one irreversible action here, so it always asks. */}
      <Modal
        ref={confirmRef}
        titleId="confirm-title"
        title={
          pendingDelete.length === 1
            ? t.admin.deleteOneTitle
            : fill(t.admin.deleteManyTitle, { count: pendingDelete.length })
        }
        closeLabel={t.common.close}
        onClose={() => setPendingDelete([])}
        className="w-[min(30rem,92vw)]"
      >
        <ul className="space-y-1 text-sm text-ink">
          {pendingDelete.map((row) => (
            <li key={row._id}>
              {row.name}
              <span className="text-ink-muted">
                {row.email || row.phone ? ` — ${row.email ?? row.phone}` : ""}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-sm leading-relaxed text-ink-muted">{t.admin.deleteBody}</p>

        <form action={deleteRsvps} className="mt-6 flex flex-wrap justify-end gap-3">
          {pendingDelete.map((row) => (
            <input key={row._id} type="hidden" name="ids" value={row._id} />
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={() => confirmRef.current?.close()}
          >
            {t.admin.cancel}
          </Button>
          <Button type="submit" className="bg-danger hover:bg-danger">
            {t.admin.deleteConfirm}
          </Button>
        </form>
      </Modal>

      <Modal
        ref={detailRef}
        titleId="detail-title"
        title={t.admin.detailTitle}
        closeLabel={t.common.close}
        onClose={() => setEditing(null)}
        className="w-[min(38rem,92vw)]"
      >
        {editing ? (
          <form action={updateRsvp} className="mt-5 space-y-5">
            <input type="hidden" name="id" value={editing._id} />

            <div>
              <Label htmlFor="edit-name">{t.admin.fieldName}</Label>
              <Input id="edit-name" name="name" defaultValue={editing.name} required />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="edit-email">{t.admin.fieldEmail}</Label>
                <Input
                  id="edit-email"
                  name="email"
                  type="email"
                  defaultValue={editing.email ?? ""}
                />
              </div>
              <div>
                <Label htmlFor="edit-phone">{t.admin.fieldPhone}</Label>
                <Input
                  id="edit-phone"
                  name="phone"
                  type="tel"
                  defaultValue={editing.phone ?? ""}
                />
              </div>
            </div>

            <fieldset>
              <FieldsetLabel>{t.admin.replyLabel}</FieldsetLabel>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { value: "yes", label: t.admin.replyAttending, on: true },
                  { value: "no", label: t.admin.replyDeclined, on: false },
                ].map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-md border px-3 py-2.5 text-center text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                      editAttending === option.on
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-border text-ink-muted hover:border-border-strong"
                    }`}
                  >
                    <input
                      type="radio"
                      name="attending"
                      value={option.value}
                      checked={editAttending === option.on}
                      onChange={() => setEditAttending(option.on)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>

            {editAttending ? (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="edit-adults">{t.admin.adults}</Label>
                    <Input
                      id="edit-adults"
                      name="adults"
                      type="number"
                      min={0}
                      max={40}
                      defaultValue={editing.adults}
                    />
                  </div>
                  <div>
                    <Label htmlFor="edit-kids">{t.admin.children}</Label>
                    <Input
                      id="edit-kids"
                      name="kids"
                      type="number"
                      min={0}
                      max={40}
                      defaultValue={editing.kids}
                    />
                  </div>
                </div>

                <div>
                  <Label htmlFor="edit-guests">{t.admin.fieldGuestNames}</Label>
                  <Input
                    id="edit-guests"
                    name="guestNames"
                    defaultValue={editing.guestNames ?? ""}
                  />
                </div>

                {mealOptions.length > 0 ? (
                  <div>
                    <Label htmlFor="edit-meal">{t.admin.fieldMeal}</Label>
                    <Select id="edit-meal" name="meal" defaultValue={editing.meal ?? ""}>
                      <option value="">{t.admin.mealNone}</option>
                      {mealOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                      {/* A meal that is no longer offered still has to survive an edit. */}
                      {editing.meal && !mealOptions.includes(editing.meal) ? (
                        <option value={editing.meal}>{editing.meal}</option>
                      ) : null}
                    </Select>
                  </div>
                ) : null}

                <div>
                  <Label htmlFor="edit-dietary">{t.admin.fieldDietary}</Label>
                  <Input
                    id="edit-dietary"
                    name="dietaryNotes"
                    defaultValue={editing.dietaryNotes ?? ""}
                  />
                </div>
              </>
            ) : null}

            {/*
              * Read-only: the message is what the guest wrote. Editing someone
              * else's words in a record that carries their name is the kind of
              * thing you can only regret. The hidden input keeps it intact
              * through a save; deleting the RSVP is the way to remove it.
              */}
            {editing.message ? (
              <div>
                <p className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                  {t.admin.fieldMessage}
                </p>
                <p className="whitespace-pre-line rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-sm italic leading-relaxed text-ink">
                  {editing.message}
                </p>
              </div>
            ) : null}
            <input type="hidden" name="message" value={editing.message ?? ""} />

            <dl className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border pt-4 text-xs text-ink-muted">
              <div className="flex gap-2">
                <dt>{t.admin.receivedLabel}</dt>
                <dd className="text-ink">{editing.receivedLabel}</dd>
              </div>
              {editing.editedLabel ? (
                <div className="flex gap-2">
                  <dt>{t.admin.updatedLabel}</dt>
                  <dd className="text-ink">{editing.editedLabel}</dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => detailRef.current?.close()}
              >
                {t.admin.cancel}
              </Button>
              <SaveButton
                label={t.admin.saveChanges}
                pendingLabel={t.admin.savingChanges}
              />
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal
        ref={dialogRef}
        titleId="merge-title"
        title={t.admin.mergeTitle}
        closeLabel={t.common.close}
        className="w-[min(34rem,92vw)]"
      >
        <form action={mergeRsvps} className="mt-5 space-y-5">
          {chosen.map((r) => (
            <input key={r._id} type="hidden" name="removeIds" value={r._id} />
          ))}

          {/*
            * Step one stays mounted, only hidden, so the chosen keepId is still
            * part of the form when step two submits.
            */}
          <div className={mergeStep === "review" ? "hidden" : "space-y-5"}>
            <fieldset className="space-y-2">
              <legend className="sr-only">{t.admin.mergeKeep}</legend>
              {chosen.map((r) => (
                <label
                  key={r._id}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                    keepId === r._id
                      ? "border-accent bg-accent-soft"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="keepId"
                    value={r._id}
                    checked={keepId === r._id}
                    onChange={() => setKeepId(r._id)}
                    className="mt-1 accent-accent"
                  />
                  <span>
                    <span className="block font-medium text-ink">{r.name}</span>
                    <span className="block text-xs text-ink-muted">
                      {[r.email, r.phone].filter(Boolean).join(" · ")}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {r.attending
                        ? partySummary(r.adults, r.kids, t)
                        : t.admin.replyDeclined}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => dialogRef.current?.close()}
              >
                {t.admin.mergeCancel}
              </Button>
              <Button type="button" onClick={() => setMergeStep("review")}>
                {t.admin.mergeNext}
              </Button>
            </div>
          </div>

          {/* Step two: the combined record, editable before it is saved. */}
          {preview ? (
            <div
              key={keepId ?? "none"}
              className={mergeStep === "choose" ? "hidden" : "space-y-5"}
            >
              <p className="text-sm leading-relaxed text-ink-muted">
                {t.admin.mergeReviewIntro}
              </p>

              <div>
                <Label htmlFor="merge-name">{t.admin.fieldName}</Label>
                <Input id="merge-name" name="name" defaultValue={preview.name} required />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="merge-email">{t.admin.fieldEmail}</Label>
                  <Input
                    id="merge-email"
                    name="email"
                    type="email"
                    defaultValue={preview.email}
                  />
                </div>
                <div>
                  <Label htmlFor="merge-phone">{t.admin.fieldPhone}</Label>
                  <Input
                    id="merge-phone"
                    name="phone"
                    type="tel"
                    defaultValue={preview.phone}
                  />
                </div>
              </div>

              <fieldset>
                <FieldsetLabel>{t.admin.mergeReply}</FieldsetLabel>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: "yes", label: t.admin.replyAttending, on: true },
                    { value: "no", label: t.admin.replyDeclined, on: false },
                  ].map((option) => (
                    <label
                      key={option.value}
                      className={`cursor-pointer rounded-md border px-3 py-2.5 text-center text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent ${
                        reviewAttending === option.on
                          ? "border-accent bg-accent-soft text-accent"
                          : "border-border text-ink-muted hover:border-border-strong"
                      }`}
                    >
                      <input
                        type="radio"
                        name="attending"
                        value={option.value}
                        checked={reviewAttending === option.on}
                        onChange={() => setReviewAttending(option.on)}
                        className="sr-only"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {reviewAttending ? (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="merge-adults">{t.admin.adults}</Label>
                      <Input
                        id="merge-adults"
                        name="adults"
                        type="number"
                        min={0}
                        max={40}
                        defaultValue={preview.adults}
                      />
                    </div>
                    <div>
                      <Label htmlFor="merge-kids">{t.admin.children}</Label>
                      <Input
                        id="merge-kids"
                        name="kids"
                        type="number"
                        min={0}
                        max={40}
                        defaultValue={preview.kids}
                      />
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-ink-muted">
                    {t.admin.mergeCountsNote}
                  </p>

                  <div>
                    <Label htmlFor="merge-guests">{t.admin.fieldGuestNames}</Label>
                    <Input
                      id="merge-guests"
                      name="guestNames"
                      defaultValue={preview.guestNames}
                    />
                  </div>

                  {mealOptions.length > 0 ? (
                    <div>
                      <Label htmlFor="merge-meal">{t.admin.fieldMeal}</Label>
                      <Select id="merge-meal" name="meal" defaultValue={preview.meal}>
                        <option value="">{t.admin.mealNone}</option>
                        {mealOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                        {preview.meal && !mealOptions.includes(preview.meal) ? (
                          <option value={preview.meal}>{preview.meal}</option>
                        ) : null}
                      </Select>
                    </div>
                  ) : null}

                  <div>
                    <Label htmlFor="merge-dietary">{t.admin.fieldDietary}</Label>
                    <Input
                      id="merge-dietary"
                      name="dietaryNotes"
                      defaultValue={preview.dietaryNotes}
                    />
                  </div>
                </>
              ) : null}

              {/* Guests' own words: combined, shown, not editable. */}
              {preview.message ? (
                <div>
                  <p className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
                    {t.admin.fieldMessage}
                  </p>
                  <p className="whitespace-pre-line rounded-md border border-border bg-surface-sunken px-3.5 py-2.5 text-sm italic leading-relaxed text-ink">
                    {preview.message}
                  </p>
                </div>
              ) : null}
              <input type="hidden" name="message" value={preview.message} />

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <span className="text-xs text-ink-muted">
                  {fill(t.admin.mergeReplacesCount, { count: chosen.length })}
                </span>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setMergeStep("choose")}
                  >
                    {t.admin.mergeBack}
                  </Button>
                  <Button type="submit">{t.admin.mergeConfirm}</Button>
                </div>
              </div>
            </div>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
