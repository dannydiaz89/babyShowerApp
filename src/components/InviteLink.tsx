"use client";

import { useRef, useState } from "react";
import { setInviteLink } from "@/app/admin/settings/actions";
import {
  Alert,
  Button,
  Card,
  CheckIcon,
  CopyIcon,
  IconButton,
  Input,
  Label,
  Overline,
} from "@/components/ui";
import type { Dictionary } from "@/lib/i18n";
import type { QrCode } from "@/lib/qr";

/**
 * The invite link and its QR, on the access tab beside the guest password.
 *
 * The codes are drawn from geometry the server worked out: the encoder stays
 * out of the browser bundle, and nothing here pushes markup into the page.
 */

export type InviteCard = {
  /** What the QR encodes and the host copies. */
  url: string;
  /** Which card this is — the invitation, or the one on the tables. */
  title: string;
  hint: string;
  /** Filename stem for the download. */
  file: string;
  qr: QrCode;
};

export type InviteLinkProps = {
  t: Dictionary;
  cards: InviteCard[];
};

/** The QR as a standalone file, at a size a printer will accept. */
function svgFile(card: InviteCard): string {
  const { size, path } = card.qr;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="1024" height="1024" shape-rendering="crispEdges">`,
    `<title>${card.title}</title>`,
    `<rect width="${size}" height="${size}" fill="#ffffff"/>`,
    `<path d="${path}" fill="#000000"/>`,
    `</svg>`,
  ].join("");
}

function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The same drawing as a PNG, for the print shop that asks for one.
 *
 * Rasterised in the browser from the SVG above rather than built on the
 * server: a PNG encoder is a dependency, and a canvas is already here.
 */
async function downloadPng(card: InviteCard): Promise<void> {
  const svg = new Blob([svgFile(card)], { type: "image/svg+xml" });
  const url = URL.createObjectURL(svg);

  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The QR could not be drawn."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas.");
    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (png) download(`${card.file}.png`, png);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * One button, one form, one word of intent.
 *
 * The intent travels in a hidden field rather than on the button, because
 * React puts the action's own id in a submit button's `name` when that button
 * carries a `formAction` — setting it ourselves hands the server the wrong
 * one, and the page fails to hydrate.
 */
function IntentForm({
  intent,
  children,
}: {
  intent: "create" | "replace" | "remove";
  children: React.ReactNode;
}) {
  return (
    <form action={setInviteLink}>
      <input type="hidden" name="intent" value={intent} />
      {children}
    </form>
  );
}

function QrCard({ card, t }: { card: InviteCard; t: Dictionary }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  return (
    <div className="rounded-md border border-border bg-surface-sunken p-4">
      <Overline as="h3">{card.title}</Overline>
      <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{card.hint}</p>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        <svg
          viewBox={`0 0 ${card.qr.size} ${card.qr.size}`}
          className="h-32 w-32 shrink-0 rounded-xs bg-white"
          shapeRendering="crispEdges"
          role="img"
          aria-label={card.title}
        >
          <path d={card.qr.path} fill="#000000" />
        </svg>

        <div className="min-w-0 flex-1">
          <Label htmlFor={`invite-url-${card.file}`}>{t.settings.inviteUrl}</Label>
          <div className="relative">
            <Input
              ref={field}
              id={`invite-url-${card.file}`}
              value={card.url}
              readOnly
              onFocus={(event) => event.currentTarget.select()}
              // Room for the button sitting on top of the field's right end.
              className="pr-11 font-mono text-xs"
            />
            <IconButton
              tone="neutral"
              label={copied ? t.settings.inviteCopied : t.settings.inviteCopy}
              className="absolute right-1 top-1/2 -translate-y-1/2"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(card.url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /*
                   * No clipboard permission, or an insecure origin. Select the
                   * link instead so the next keystroke copies it: a button
                   * that looks like it worked and did nothing is worse than no
                   * button, and this is the link the printer is waiting for.
                   */
                  field.current?.focus();
                  field.current?.select();
                }
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </IconButton>
          </div>
          {/*
            * The icon swap is the whole feedback, and an icon is nothing to a
            * screen reader. Say it in words as well — politely, so it waits
            * for a gap rather than cutting across what is being read.
            */}
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? t.settings.inviteCopied : ""}
          </span>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() =>
                download(
                  `${card.file}.svg`,
                  new Blob([svgFile(card)], { type: "image/svg+xml" })
                )
              }
            >
              {t.settings.inviteDownloadSvg}
            </Button>
            <Button type="button" variant="secondary" onClick={() => downloadPng(card)}>
              {t.settings.inviteDownloadPng}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InviteLink({ t, cards }: InviteLinkProps) {
  /*
   * Keyed on the link itself, which is what everything inside is about: a
   * half-finished "remove it?", a "Copied" that has not faded yet. Make,
   * replace or remove a link and none of that means anything any more — the
   * panel is looking at a different thing. Without the key React keeps the
   * state, and the confirmation you opened before removing one link is still
   * sitting there, on the buttons for the link you just made.
   */
  return <LinkPanel key={cards[0]?.url ?? "none"} t={t} cards={cards} />;
}

function LinkPanel({ t, cards }: InviteLinkProps) {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const made = cards.length > 0;

  return (
    <Card className="mt-6 px-6 py-6 sm:px-7">
      <Overline as="h2">{t.settings.inviteTitle}</Overline>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">{t.settings.inviteIntro}</p>

      {made ? (
        <>
          <div className="mt-5 space-y-4">
            {cards.map((card) => (
              <QrCard key={card.file} card={card} t={t} />
            ))}
          </div>

          <Alert tone="neutral" className="mt-5">
            {t.settings.inviteKeepPassword}
          </Alert>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <IntentForm intent="replace">
              <Button type="submit" variant="secondary">
                {t.settings.inviteReplace}
              </Button>
            </IntentForm>

            {confirmingRemove ? (
              <>
                <IntentForm intent="remove">
                  <Button type="submit">{t.settings.inviteRemoveConfirm}</Button>
                </IntentForm>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setConfirmingRemove(false)}
                >
                  {t.common.cancel}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingRemove(true)}
              >
                {t.settings.inviteRemove}
              </Button>
            )}

            <p className="w-full text-xs leading-relaxed text-ink-muted">
              {t.settings.inviteReplaceHint}
            </p>
          </div>
        </>
      ) : (
        <div className="mt-5">
          <IntentForm intent="create">
            <Button type="submit">{t.settings.inviteCreate}</Button>
          </IntentForm>
        </div>
      )}
    </Card>
  );
}
