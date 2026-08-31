# Tests

`tests/` mirrors the source tree, so the path of a test tells you what it
covers and where a new one belongs:

| Source | Test |
| --- | --- |
| `src/lib/auth.ts` | `tests/lib/auth.test.ts` |
| `src/lib/i18n/text.ts` | `tests/lib/i18n/text.test.ts` |
| `convex/rsvps.ts` | `tests/convex/rsvps.test.ts` |

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

## Two things worth knowing

**The timezone is pinned to `America/Los_Angeles`** in `vitest.config.mts`,
deliberately west of UTC. `formatDateShort` guards against a bare
`YYYY-MM-DD` parsing as UTC and landing on the previous day — a bug that
*cannot reproduce in UTC*, so a UTC runner would stay green while broken.

**A passing suite proves nothing by itself.** These tests were checked by
breaking the code on purpose — dropping the role check, reverting the locale
parser to first-tag-wins, summing merged parties instead of taking the max —
and confirming each one turns the suite red. If you add a test, try breaking
what it covers and make sure it fails. One test here originally passed for the
wrong reason and only that exercise caught it.

## What is not covered

No component or browser tests. The UI was verified by hand against a running
server, and the pieces most likely to break silently are the pure functions
above. Adding React Testing Library later would be reasonable; it is not
pretending to be here now.
