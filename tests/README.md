# Tests

`tests/` mirrors the source tree, so the path of a test tells you what it
covers and where a new one belongs:

| Source | Test |
| --- | --- |
| `src/lib/auth.ts` | `tests/lib/auth.test.ts` |
| `src/lib/i18n/text.ts` | `tests/lib/i18n/text.test.ts` |
| `convex/rsvps.ts` | `tests/convex/rsvps.test.ts`, `tests/convex/totals.test.ts`, `tests/convex/rebuild.test.ts` |
| `src/app/rsvp/actions.ts` | `tests/app/rsvp-actions.test.ts` |
| `convex/photos.ts`, `convex/drive.ts` | `tests/convex/photos.test.ts` |
| `src/app/api/photos/**` | `tests/app/photos-api.test.ts` |
| `src/lib/photo-wall.ts` | `tests/lib/photo-wall.test.ts` |
| `src/lib/justified.ts` | `tests/lib/justified.test.ts` |
| `src/lib/seal.ts` | `tests/lib/seal.test.ts` |

```bash
pnpm test        # once
pnpm test:watch  # on change
```

## What is covered, and why

These are the parts where a quiet bug costs something real: someone gets into
the dashboard, a guest is counted twice, an allergy note disappears, or half
the family reads the wrong language.

- **`lib/auth`** — session tokens. That a guest cookie cannot open the admin
  dashboard, that an edited role or expiry is rejected, and that a genuinely
  signed token stops working once it expires.
- **`lib/password`** — the guest password is stored PBKDF2-hashed, salted per
  record, and a record whose iteration count has been lowered is refused.
- **`lib/rsvp`** — merging duplicates keeps every allergy note and message,
  and takes the largest party rather than the sum.
- **`lib/i18n/locales`** — `Accept-Language` is quality-ranked, not ordered.
- **`lib/i18n/text`** — optional fields hide rather than render blank labels,
  and a date does not slip a day.
- **`convex/rsvps`** — the email and phone keys that decide whether a second
  submission updates a guest or duplicates them.
- **`app/rsvp/actions`** — that `submitRsvp` refuses a caller with no session,
  a forged or expired one, or an admin token in the guest cookie. Middleware
  does not run for Server Actions, so `/rsvp` being gated proves nothing here.
- **`app/actions` (guest sign-in)** — that an unreadable settings row fails
  closed instead of falling back to `SITE_PASSWORD`, that the fallback still
  works when nothing is stored, and that `next` cannot send a guest off-site.
- **`lib/nav`** — the redirect allowlist, including protocol-relative and
  control-character attempts.
- **`lib/date-parts`** — that an impossible day like `2026-02-31` is rejected
  rather than stored and displayed as March 3rd.
- **`lib/csv`** — that a guest-written cell cannot run as a spreadsheet formula.
- **`lib/paging`** — that walking the RSVP pages leaves no reply behind, and
  stops rather than spinning if a pager never advances. A row the dashboard
  drops is a guest who cannot be edited, merged or deleted at all.
- **`lib/meals`** — that only a meal on the menu is accepted, in either
  language, and that guest free text is length-bounded. The submitted meal
  becomes an entry in one shared totals document, so an unchecked value is an
  availability problem rather than an untidy one.
- **`convex/rsvps` totals** — the arithmetic behind every number on the
  dashboard: that taking a reply back undoes exactly what adding it did, and
  what each write moves a meal's tally by.
- **`convex/rsvps` against a database** (`tests/convex/rebuild.test.ts`) — the
  real mutations run against a real database via `convex-test`, because some
  bugs are only reachable that way. A rebuild once read a bounded page of meal
  tallies and deleted only those, then inserted a fresh row for every meal in
  the table: past that bound the leftovers stayed, and a meal that was both
  left over and still current ended up with two rows — after which every write
  for it threw on the unique lookup. No amount of testing the arithmetic in
  isolation reaches that code.
- **meals, end to end** (`tests/meals-end-to-end.test.ts`) — that a meal the
  settings form accepts always reaches the catering totals. This one is spread
  across the settings boundary, the RSVP action and the tally on purpose,
  because it is where they twice drifted apart: first a cap silently dropped
  meals settings had accepted, then aligning the two limits still let labels
  from an older menu crowd out a new option.

- **`convex/photos` against a database** — who may hide what, and that the
  counters and the stored files stay in step with the rows. The uploader's
  device id must never appear in a wall page; a non-owner's hide must change
  nothing; a delete must take the web copy with it in the same transaction.
  One of these caught a real Convex rule: a mutation that throws rolls back
  its own storage delete, so a refused oversize copy stayed in storage until
  the refusal became a return value.
- **`api/photos` routes** — each Route Handler is a public endpoint outside
  the middleware gate, exactly like a Server Action. That no session gets
  nothing; that a guest cannot reach restore or delete; that a guest with no
  device cookie is refused before the database is asked; that a claimed Drive
  file id is checked against the folder before it is recorded; and that
  uploads close with the wall.
- **`lib/photo-wall`** — the wall opens by the event's calendar date where
  the shower is, not in UTC. Checked at 05:30 UTC on the event date, which is
  still the evening before in Los Angeles.
- **`lib/justified`** — the arithmetic behind the wall's rows: a full row
  spans the container to the pixel, photos keep their proportions, and a
  short last row is never stretched to fit.
- **`lib/seal`** — the Drive refresh token cannot be read back without the
  secret, and an altered value is refused rather than decrypted wrong.
- **`lib/csp`** — the two added origins land in the two right directives and
  nowhere else, and a malformed origin value cannot widen the policy.
- **`lib/image-prep`** — the resize arithmetic. The canvas half needs a
  browser and is kept thin.

## Two things worth knowing

**The timezone is pinned to `America/Los_Angeles`** in `vitest.config.mts`,
deliberately west of UTC. `formatDateShort` guards against a bare
`YYYY-MM-DD` parsing as UTC and landing on the previous day — a bug that
*cannot reproduce in UTC*, so a UTC runner would stay green while broken.

**A passing suite proves nothing by itself.** These tests were checked by
breaking the code on purpose — dropping the role check, reverting the locale
parser to first-tag-wins, summing merged parties instead of taking the max,
removing the Server Action session check, letting an outage fall back to
`SITE_PASSWORD` — and confirming each one turns the suite red. If you add a
test, try breaking what it covers and make sure it fails. One test here
originally passed for the wrong reason and only that exercise caught it.

## Two kinds of test here

Most of these are pure functions, called directly. The Convex ones in
`tests/convex/rebuild.test.ts` are different: they use
[`convex-test`](https://docs.convex.dev/testing/convex-test) to run the real
mutations against a real database, and carry a
`// @vitest-environment edge-runtime` docblock because that is the runtime
Convex functions actually run in. Reach for those whenever the behaviour
involves reading or writing documents rather than computing a value.

## What is not covered

No component or browser tests — so the unsaved-changes navigation guard, the
date/time field labelling, the photo wall's layout in a real viewport and the
upload flow's canvas work are verified by hand, not here. The UI was
verified against a running server, and the pieces most likely to break
silently are the pure functions above. Adding React Testing Library later
would be reasonable; it is not pretending to be here now.
