# Baby Shower Site

A password-gated invitation site with RSVP tracking, in English and Spanish.
Next.js on Vercel, Convex for the database. Two shared passwords, no guest
accounts, and every detail editable from the admin page — nothing to
administer week to week.

## What's here

| Page | Who sees it | What it does |
| --- | --- | --- |
| `/` | Anyone with the invitation password | The gate |
| `/invitation` | Guests | Date, place, details, add-to-calendar |
| `/rsvp` | Guests | The RSVP form |
| `/registry` | Guests | Links to your registries |
| `/photos` | Guests, from the event date | The photo wall: everything guests have added |
| `/photos/add` | Guests, from the event date | Upload up to ten photos at a time |
| `/admin` | Hosts | Host sign-in (separate password) |
| `/admin/dashboard` | Hosts | Headcounts, meal totals, every response, CSV export |
| `/admin/photos` | Hosts | Every photo, including ones guests removed; restore or delete for good |
| `/admin/settings` | Hosts | Everything guests see |

## Editing the site

Sign in at `/admin`, then open **Settings**. It's split into six sections —
The event, Wording, Registries, RSVP form, Photos, Guest password — and
**each one saves on its own**. Switching sections with unsaved edits asks whether to
discard them or stay put.

Names, dates, venue, registries, meal options, contact details, and the guest
password all live there and go live the moment you save.

Free text (tagline, notes, dress code, registry descriptions) has an English
and a Spanish box. Leave the Spanish blank and Spanish readers see the English.
Dates are stored as real dates and formatted per language, so you never type
"Saturday, October 18" and discover it was a Sunday.

`src/lib/defaults.ts` holds what a fresh install shows before the first save.
That is the only file to touch when forking this for a different event.

## The photo wall

On the day of the shower a banner appears above the invitation and a
**Photos** tab joins the guest nav. Guests pick up to ten photos at a time from
their phone, see thumbnails at once, add an optional name, and tap once to
upload. The wall shows everyone's photos in justified rows, newest first,
loading more as you scroll; tapping one opens a full-screen viewer with swipe,
arrows and keyboard.

There are still no accounts. The first visit to the photo pages sets a random
device cookie, and a photo remembers the device that added it — "your photos"
means "photos from this phone". A guest can remove their own photos, which
only hides them: hosts see hidden photos on `/admin/photos` and are the only
ones who restore or delete for good.

**Where photos go.** Settings → Photos offers two storages for the original:

- **This site** (the default, no setup). Originals are not kept. The phone
  makes a ~2400px WebP (JPEG on browsers that cannot encode WebP), good for
  phones and prints up to about 8×10, and that is what the wall shows. These
  live in Convex file storage inside a 500 MB cap; the host pages show a
  meter, and at the cap uploads stop until photos are deleted.
- **Google Drive.** The phone makes a ~1600px web copy for the wall and sends
  the untouched original straight to a folder in the hosts' own Google Drive
  — the bytes never pass through Vercel, which could not take them anyway.
  Connect the Drive once from Settings → Photos (see
  [Google Drive](#google-drive) below).

Changing the choice only affects photos added from then on. If Drive is the
chosen storage and it is not connected, or Google stops answering, uploads
**pause** for everyone rather than quietly losing originals: the upload page
sends guests back to the wall with a "try again later" note, the host pages
say what happened and offer Check again, Reconnect, or switching to this
site, and an outage on Google's side clears itself — the site re-probes every
couple of minutes on a page load. A revoked grant only clears on reconnect.

"This site" maps onto Convex file storage on purpose: Convex also ships a
self-hosted backend as a Docker image that keeps files on a local volume, so
the same code path is "local storage" in a container later.

**When it opens and closes.** By default the wall opens at midnight on the
event date, by the clock in the event's time zone — set on the Event tab in
Settings, and worth checking before the day. Settings → Photos can open it now, for a test run,
and holds the closing date and time, preset to a week after the event. On
that moment uploads stop while what was added stays viewable. Change it if
you like; left as the preset it follows the event date if that moves.

The design and the decisions behind it are in
[docs/photo-wall.md](docs/photo-wall.md).

## Languages

The site picks a language from the reader's browser and remembers an explicit
choice in a cookie. Every page has a toggle. Interface text lives in
`src/lib/i18n/dictionaries.ts` — `en` is the source of truth and TypeScript
will not compile if `es` is missing a key, so a new string can't silently ship
untranslated.

## Setup

Requires **pnpm** and Node 20+.

```bash
pnpm install
```

Copy `.env.example` to `.env.local`, then create your Convex project (this is
interactive the first time and needs a Convex account):

```bash
pnpm convex
```

It prints a deployment URL — put it in `CONVEX_URL`. Fill in the rest of
`.env.local`, then give Convex the same shared key:

```bash
pnpm exec convex env set ADMIN_API_KEY <the same value as in .env.local>
```

### Google Drive

Optional, and the only setup step that involves a third party. It lets guest
photos be saved at full quality to a folder in your own Google Drive.

1. In [Google Cloud](https://console.cloud.google.com/), make a project (or
   use one), enable the **Google Drive API**, and create an OAuth client of
   type **Web application**.
2. Add `https://<your site>/api/google/callback` — and
   `http://localhost:3001/api/google/callback` for development — as authorised
   redirect URIs.
3. On the OAuth consent screen, set the publishing status to **In production**.
   In "Testing", Google expires the refresh token after seven days and the
   connection silently stops working. The only scope used, `drive.file`, is
   non-sensitive, so no verification is needed.
4. Put the client id and secret in `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` (`.env.local` locally, the project settings on
   Vercel).
5. Sign in at `/admin`, open Settings → Photos, and press **Connect Google
   Drive**. The site creates its own folder in your Drive and shows a link to
   it.

The `drive.file` scope reaches only files and folders the site itself created —
never the rest of your Drive. You can revoke it any time from your Google
account's connected-apps page; the folder and the photos in it stay yours.

### Running it

The dev server is pinned to **http://localhost:3001** (`next dev --port 3001`).
Change the port in the `dev` and `start` scripts in `package.json` if you need
a different one.

```bash
pnpm dev
```

That runs the site alone. To run the site and Convex together in one terminal:

```bash
pnpm dev:all
```

Two things worth knowing:

- **Never let a second process touch `.next` while `pnpm dev` is running.**
  A `pnpm build`, another `next dev`, or a `rm -rf .next` will pull files out
  from under the running server, which then throws `ENOENT` on
  `routes-manifest.json`, `_document.js` and the webpack cache until it is
  restarted. Use `pnpm dev:scratch` for a second instance — it runs on port
  3099 with its own `.next-scratch` directory (via the `NEXT_DIST_DIR`
  override in `next.config.ts`) and leaves the main one alone. If it does
  happen: stop everything, `rm -rf .next`, start again.
- If an export moves between files while the dev server is running, Fast
  Refresh can keep the old module binding and report a symbol as `undefined`
  even though the source is correct. Restart the dev server; it isn't a code
  problem and no cache needs clearing.

### Testing on a phone

The dev server prints a Network address (`http://192.168.x.x:3001`). Open that
on a phone on the same Wi-Fi. Type the `http://` yourself — phone browsers
default to HTTPS, and the dev server does not speak TLS.

The `upgrade-insecure-requests` and HSTS headers are production-only for this
reason: in development they would rewrite that address to `https://`, which
fails with `ERR_SSL_PROTOCOL_ERROR` or loads the page with no stylesheet.
- `pnpm install` deliberately allows `esbuild` to run its install script
  (`pnpm.onlyBuiltDependencies` in `package.json`). Convex bundles your
  functions with esbuild and won't work without its platform binary.

### Sample data

To try the dashboard with something in it:

```bash
pnpm seed
```

That adds twelve sample guests covering the cases worth looking at — parties
with children, declines, meal preferences, allergy notes, a guest with no
email address, and two deliberate duplicate pairs for trying the merge flow.

```bash
pnpm seed:clear
```

Sample rows are tagged: their emails use the reserved `example.com` domain and
their phone numbers use the `555-01xx` range reserved for fiction. Clearing
only removes rows matching those, so it cannot delete a real RSVP. **Run it
before you send the invitations.**

## Deploying to Vercel

1. Push to GitHub and import the repo in Vercel.
2. Add all five environment variables (Settings → Environment Variables).
3. Set the install command to `pnpm install` and the build command to
   `pnpm exec convex deploy --cmd 'pnpm build'`.
4. Set the key on production Convex too:
   `pnpm exec convex env set --prod ADMIN_API_KEY <value>`

## Security

The guest list — names, emails, phone numbers — is the thing worth protecting.
Here is what protects it and what does not.

**The guest password is not the sensitive one.** Someone who gets it off a
forwarded invitation sees the event details and could file a fake RSVP. They
cannot see other guests: the dashboard sits behind a different password, and
the browser never talks to Convex directly.

**The admin password is the whole perimeter.** Make it long and random. Nothing
below compensates for `hostsonly`.

What's in place:

- **Guessing is rate-limited.** Five wrong admin passwords from an address
  triggers a 30-minute lockout that doubles with each further attempt (guests
  get ten tries and 15 minutes). Without this, a shared password falls to a
  script in seconds.
- **If the limiter can't be reached, admin sign-in closes** rather than running
  unlimited. A Convex outage means you can't read RSVPs for a while; it does
  not mean an attacker gets free guesses.
- **Admin sessions last 12 hours**, not the 30 days guests get.
- **Convex answers only to your server.** Every function requires
  `ADMIN_API_KEY`, compared in constant time. The deployment URL alone gets an
  attacker nothing, and no Convex credential is ever sent to a browser.
- **Admin responses are never cached** — `no-store` plus `noindex` on every
  `/admin` route, including the CSV export, so the guest list can't linger in a
  CDN, proxy, or search index.
- **`Referrer-Policy: no-referrer`.** Without it, every guest clicking through
  to Amazon or Target would hand them your invitation URL.
- **A nonce-based CSP.** Every response carries a fresh nonce and Next.js
  stamps it on the scripts it inlines, so `script-src` names that one script
  and refuses any other — an injected `<script>` does not run. Alongside it:
  `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, HSTS, a
  `Cross-Origin-Opener-Policy` that severs `window.opener` on the registry
  links, and a Permissions-Policy that turns off camera, microphone, and
  geolocation.
- **The guest password is hashed** (PBKDF2-SHA256, 210k iterations) when set
  from the Settings page, so the database never holds the password itself.
- **RSVP submissions are throttled** to 12 per address per hour, so nobody with
  the guest password can flood your headcount.
- **You can collect less.** Turn off the phone field in Settings and it is
  neither asked for nor stored.
- **A guest can only remove their own photos, and remove only hides.** The
  device cookie that marks "yours" is never sent back to a browser — the
  server answers `mine: true` per photo — so nobody can hide another phone's
  photos, and nothing a guest does deletes anything. Hosts delete.
- **Every photo route checks the session itself**, like the Server Actions.
  Uploads are throttled per device (the cookie is signed, so it cannot be
  made up to dodge this) and, as a backstop set far above what a whole
  party produces on one Wi-Fi address, per address. What actually answers
  someone misusing the guest password to push originals into the Drive
  folder is that the folder is tidied: every ten minutes at most, any file
  older than thirty minutes that no photo record points at is deleted.
- **The Drive refresh token is sealed** (AES-GCM under a key derived from
  `AUTH_SECRET`) before it is stored, so a copy of the database alone cannot
  reach your Drive. The site asks Google for the `drive.file` scope only.
- **Photos load from two named origins and nowhere else.** The CSP admits the
  Convex storage host for images and Google's upload host for the phone's
  direct PUT; everything else stays `'self'`.

Known limits, stated plainly:

- Changing the guest password signs every guest out. Cookies are signed
  rather than stored, so nothing on the server is deleted; instead each guest
  page refuses a cookie minted before the last password change, and the
  guest enters the new password once.
- Rate limiting is per IP address. It stops scripted guessing; it does not stop
  a determined attacker with many addresses. A strong admin password does.
- Anyone with the admin password can export the entire guest list as a CSV.
  Treat that file the way you'd treat the list itself. Guest-written cells that
  start with `=`, `+`, `-` or `@` are prefixed so a spreadsheet reads them as
  text rather than running them as a formula.
- Server Actions are their own public endpoints — middleware does not run for
  them — so each one checks the session itself rather than relying on the page
  it belongs to being gated.
- If the settings cannot be read, guest sign-in fails closed rather than
  falling back to `SITE_PASSWORD`. An outage must not reinstate a password the
  hosts have already rotated away from.
- Photo web copies are served from Convex storage by unguessable URL. Anyone
  holding such a URL can load that image without the guest password; the
  wall itself is gated, and nothing links the URLs from outside it.
- An upload abandoned between the original reaching Drive and the record
  being written leaves a file in the Drive folder with no photo on the wall
  for up to about forty minutes, until the folder is next tidied.
- The photo wall has been tested lightly, not at event load. Convex's free
  tier includes 1 GB of file bandwidth a month; a busy day of scrolling could
  approach it. The direct phone-to-Drive upload should be tried on a real
  phone over cellular before the day.

## Design system

One source of truth, in two layers.

**Tokens** live in the `@theme` block at the top of
[`src/app/globals.css`](src/app/globals.css) — color, radius, elevation, type.
Nothing else in the app hard-codes a hex value, a radius, or a shadow.

**Primitives** live in [`src/components/ui/`](src/components/ui) and are the
only place tokens become styles: `Button`, `Card`, `Input`, `Select`,
`Textarea`, `Checkbox`, `Label`, `Alert`, `Badge`, `Callout`, `ProgressBar`,
`Stat`, `NavLink`, `SegmentedControl`, `TabList`, and the type scale. Pages compose these; a page
that writes its own `bg-…` or `rounded-…` for a component is a bug.

That layering is why the host pages and the guest pages can't drift: both
render the same `SiteHeader` with a different set of links.

### Conventions

- **No pills.** The radius scale stops at `--radius-xl` (1.125rem) and has no
  fully-rounded step. Selected states are shown with an underline (nav, tabs)
  or a soft-rectangle fill (segments, badges) — never a lozenge.
- **Two greens, two jobs.** `--color-accent` is for text and actions and clears
  AA everywhere. `--color-accent-line` is lighter and decorative only: icons,
  rules, ornament. Never put text in it.
- **Contrast is verified, not assumed.** Every text token clears 4.5:1 against
  every surface it can land on, including the `danger-soft` background an
  invalid field takes on.
- **One focus treatment**, defined once in the base layer of `globals.css`.

## Accessibility

Checked, not assumed:

- Every text color clears WCAG AA (4.5:1) against every background it appears
  on. The lighter sage and clay are decorative only — icons, rules, badge
  fills — and never carry text.
- Every form control has a real `<label>`; related controls are grouped in a
  `<fieldset>` with a `<legend>`.
- Failed validation renders a summary that takes focus and is announced, with
  each message linking to the field it belongs to. Fields get `aria-invalid`
  and point at their error with `aria-describedby`.
- A visible focus ring on everything interactive, `aria-current` on the active
  nav item and language, and headings that never skip a level. There's no skip
  link: the nav is three items, and the `header`/`nav`/`main` landmarks give
  screen reader users a way past it.
- The `lang` attribute follows the chosen language, so screen readers switch
  pronunciation.
- `prefers-reduced-motion` is respected.

## Changing your answer

RSVPs are keyed on email address. A guest who submits twice with the same
address updates their answer instead of being counted twice. You can also
delete any row from the dashboard.

### How the dashboard counts

The headline numbers come from a single `rsvpTotals` row that every write to
`rsvps` updates in the same transaction, rather than from reading the table and
adding it up — Convex has no count operator, and a whole-table read stops
working once the table is large enough.

Meal tallies are **one document per meal**, not a field on that row. Anything
stored on the totals row is rewritten by every RSVP write, so it has to stay a
fixed size for ever — a growing list of meals would eventually pass the
document size limit and take every RSVP down with it. Capping the list instead
only moved the failure somewhere quieter: a meal past the cap was simply
missing from the catering numbers you order food against, with nothing on
screen to say so. A document each has neither problem, and nothing turns a
configured meal away.

The RSVP action still refuses a meal that isn't on your menu — the form offers
a `<select>`, but a Server Action is a public endpoint and the markup
constrains nothing — so guests cannot invent meals. Meal labels are also never
Convex record keys, because those must be ASCII and you name the options
yourself; "Niños" or "Entrée" would otherwise make every RSVP choosing that
option fail to save.

The table reads 200 replies at a time and offers **Load more**, because the
table is where you edit, merge and delete — the CSV is read-only, so it is not
a substitute for a row you cannot see. Past 5,000 rows on one page it stops
offering and points at the export instead. The export walks every page.

An existing deployment, or one restored from a backup, has no totals row yet.
The first dashboard visit builds it once (`rsvps.rebuildTotals`) and it stays
current from then on; `pnpm seed` builds it too, so its summary is not zero on
a fresh install.

## Checks

```bash
pnpm lint        # ESLint, configured in eslint.config.mjs
pnpm typecheck
pnpm test
pnpm check:contrast
```

### Tests

Vitest, no browser. `tests/` mirrors the source tree, so a test's path says
what it covers — `tests/lib/auth.test.ts` covers `src/lib/auth.ts`. Most are
pure functions; the Convex ones run the real mutations against a real database
with `convex-test`. See [tests/README.md](tests/README.md) for what is covered
and why.

They target the places where a quiet bug costs something real: a guest cookie
opening the admin dashboard, a guest counted twice, an allergy note lost in a
merge, or half the family reading the wrong language. Every one of them was
checked by deliberately breaking the code and confirming the suite goes red.

CI runs lint, types, tests, the WCAG contrast check and a production build on
every push and pull request — see
[.github/workflows/ci.yml](.github/workflows/ci.yml).

## Using this for your own shower

Fork it. `src/lib/defaults.ts` is the only file you need to touch — it holds
the names, date, venue, registries and contact details a fresh install shows
before you save anything from the admin page. Everything else is configurable
at runtime.

Two things to get right before you send invitations, because neither has a
safe default:

- **Set a real `ADMIN_PASSWORD`.** It is the only thing standing between the
  internet and your guests' names, emails and phone numbers. Use
  `openssl rand -hex 16`, not a word. The rate limiter buys you time against
  guessing; it is not a substitute for a strong password.
- **Clear the sample guests** with `pnpm seed:clear` so your first real
  headcount isn't twelve invented people.

This is a personal project shared in case it's useful. It is provided as-is
and I'm not offering support — no guarantees of fixes, reviews or answers to
issues. You are welcome to fork it and take it wherever you like.

## License

[MIT](LICENSE). Use it, change it, ship it; just keep the copyright notice.
It comes with no warranty of any kind — if you run it, running it safely is
on you.
