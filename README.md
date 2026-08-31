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
| `/admin` | Hosts | Host sign-in (separate password) |
| `/admin/dashboard` | Hosts | Headcounts, meal totals, every response, CSV export |
| `/admin/settings` | Hosts | Everything guests see |

## Editing the site

Sign in at `/admin`, then open **Settings**. It's split into five sections —
The event, Wording, Registries, RSVP form, Guest password — and **each one
saves on its own**. Switching sections with unsaved edits asks whether to
discard them or stay put.

Names, dates, venue, registries, meal options, contact details, and the guest
password all live there and go live the moment you save.

Free text (tagline, notes, dress code, registry descriptions) has an English
and a Spanish box. Leave the Spanish blank and Spanish readers see the English.
Dates are stored as real dates and formatted per language, so you never type
"Saturday, October 18" and discover it was a Sunday.

`src/lib/defaults.ts` holds what a fresh install shows before the first save.
That is the only file to touch when forking this for a different event.

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
- **CSP with `frame-ancestors 'none'`**, `X-Frame-Options`, `nosniff`, HSTS, and
  a Permissions-Policy that turns off camera, microphone, and geolocation.
- **The guest password is hashed** (PBKDF2-SHA256, 210k iterations) when set
  from the Settings page, so the database never holds the password itself.
- **RSVP submissions are throttled** to 12 per address per hour, so nobody with
  the guest password can flood your headcount.
- **You can collect less.** Turn off the phone field in Settings and it is
  neither asked for nor stored.

Known limits, stated plainly:

- Changing the guest password stops new sign-ins with the old one. Guests
  already signed in keep their session until it expires — signed cookies are
  checked without a database round trip, which is what keeps the site fast.
- Rate limiting is per IP address. It stops scripted guessing; it does not stop
  a determined attacker with many addresses. A strong admin password does.
- Anyone with the admin password can export the entire guest list as a CSV.
  Treat that file the way you'd treat the list itself.

## Design system

One source of truth, in two layers.

**Tokens** live in the `@theme` block at the top of
[`src/app/globals.css`](src/app/globals.css) — color, radius, elevation, type.
Nothing else in the app hard-codes a hex value, a radius, or a shadow.

**Primitives** live in [`src/components/ui/`](src/components/ui) and are the
only place tokens become styles: `Button`, `Card`, `Input`, `Select`,
`Textarea`, `Checkbox`, `Label`, `Alert`, `Badge`, `Stat`, `NavLink`,
`SegmentedControl`, `TabList`, and the type scale. Pages compose these; a page
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
