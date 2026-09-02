# Photo wall

A "Photos" tab where guests upload photos during the shower. Originals go to
the hosts' own Google Drive at full quality; a small web copy is what the
gallery shows. No guest accounts: a device cookie marks which photos are
"yours", and a guest's remove only hides — the hosts are the only ones who
delete for good.

Mockups and the decisions behind them:
https://claude.ai/code/artifact/66157bd8-ca15-4d5e-9a2f-7f789df68fe3

## Decisions (settled)

- **Originals → the hosts' Google Drive**, connected once from Settings with
  the hosts' own Google account and the narrow `drive.file` permission. The app
  creates its own folder and can reach nothing else in the Drive. A service
  account was rejected: it would own the files and count them against its own
  quota.
- **Web copies → Convex file storage** for now. ~1600px WebP made on the
  phone, JPEG when the browser cannot encode WebP. Kept behind one seam so S3
  or similar can replace it later.
- **Banner and tab appear automatically on the event date** and stay on.
  A host setting can open the wall early. Closing is a date and time, not a
  switch: preset to a week after the event and editable in Settings. At
  that moment uploads stop and the gallery stays viewable.
- **Identity is a 30-day device cookie**, matched to the guest session. A
  photo remembers the device that uploaded it; "your photos" means "from this
  phone". Never sent to the browser as data — the server answers `mine: true`.
- **Remove hides; hosts delete.** Guest remove marks the row hidden. Hosts see
  hidden photos, can restore them, or delete for good (row, web copy, then
  the Drive file).
- **Preview first, upload on tap.** Thumbnails come from the phone's own
  files, instantly. Nothing uploads until "Add to the photo wall". × before
  that is free; × during upload cancels that file.
- **10 per batch, 25 MB each, three uploads at a time.** Overall progress bar,
  button greyed while uploading.
- **Justified rows, infinite scroll** in pages of 24, newest first. Tap opens a
  viewer with swipe / arrows / keyboard.

## Where a photo goes

```
phone ──(resize in browser)──┐
  │                          ├─ web copy ──▶ POST /api/photos ──▶ Convex storage + photos row
  └─ original ──▶ PUT to a Drive resumable-upload URL ──▶ hosts' Drive folder
                    ▲
       POST /api/photos/session opens the session server-side and hands the
       phone the URL. No multi-megabyte file ever passes through Vercel.
```

## Plan

Each box is one unit of work; ticked as it lands. Order matters: the backend
and pure helpers first so the UI is built on tested ground.

### 1. Backend
- [x] `photos` table (status, uploader, web copy, drive id, hidden-by) with a
      `by_status` index; `photoTotals` counter row; `driveConnection` row
- [x] `settings.photoWall` mode (`auto` / `open` / `closed`)
- [x] `convex/photos.ts`: upload URL, create, paginated wall (live for guests,
      any filter for hosts, `mine` computed server-side), hide, restore,
      remove (deletes the web copy in the same transaction), totals
- [x] `convex/drive.ts`: get / set / clear the Drive connection
- [x] Tests against a real database (`tests/convex/photos.test.ts`): a
      non-owner cannot hide, hide/restore/remove keep the totals honest, the
      uploader id never appears in a wall page, remove deletes the stored file

### 2. Pure helpers
- [x] `lib/photo-wall.ts`: is the wall open, from the mode, event date and
      a time zone — no wall clock inside
- [x] `lib/justified.ts`: the row layout, given aspect ratios and a width
- [x] `lib/seal.ts`: AES-GCM sealing for the Drive refresh token, keyed from
      `AUTH_SECRET`
- [x] `lib/csp.ts`: image origin for the web copies, connect origin for Drive
- [x] `lib/image-prep.ts`: fit-within maths (the browser half is untestable
      here and is kept thin)
- [x] Tests for each

### 3. Server side
- [x] `lib/google-drive.ts`: OAuth URLs, token exchange and refresh, create
      folder, open a resumable session, get and delete a file
- [x] `lib/photos.ts`: the device cookie, page loading, the storage seam
- [x] `/api/photos/session`, `/api/photos` (finalize), `/api/photos` (page),
      `/api/photos/[id]/hide|restore`, `DELETE /api/photos/[id]`
- [x] `/api/google/start`, `/api/google/callback`, `/api/google/disconnect`
- [x] Rate limits on session opens and hides
- [x] Tests: every route refuses a caller with no session; hide checks the
      device cookie; delete is hosts-only and removes the Drive file

### 4. Guest UI
- [x] Design system: gold callout tone, viewer surface tokens, progress bar,
      new icons — tokens in `globals.css`, primitives in `components/ui`,
      contrast pairs registered in `scripts/check-contrast.mjs`
- [x] Strings in both languages
- [x] "Photos" in the guest nav and the day-of banner on the invitation
- [x] `/photos`: the wall, infinite scroll, viewer, remove
- [x] `/photos/add`: pick, local thumbnails, name field, per-photo and overall
      progress, cancel, retry, done

### 5. Host UI
- [x] Settings → Photos tab: wall mode, connect / disconnect Google Drive
- [x] `/admin/photos`: all / hidden filter, restore, delete for good
- [x] "Photos" in the host nav

### 6. Docs and checks
- [x] README: what's here, setup for Google, security notes, known limits
- [x] `tests/README.md`: what the new tests cover and why
- [x] `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [x] lint, typecheck, tests, contrast, build all green
- [x] Walk through in the browser: banner, upload, wall, viewer, remove,
      host restore and delete (done on the dev deployment without Google
      configured, so the Drive half ran its "not connected" path)

## Found while verifying

- **Three uploads at once minted three device cookies.** The first request
  from a device set the cookie, but the batch opens three sessions in
  parallel, so each minted its own and two thirds of the batch was not
  "yours". Now the middleware sets the cookie on the page load, and the
  uploader opens the first session alone before the other lanes start.
- **`img.decode()` never resolves in a hidden tab.** Thumbnails stalled at
  "Preparing…" whenever the page was not the visible tab. The loader waits on
  `load` instead and lets the canvas draw do the decoding.
- **A mutation that throws rolls back its own storage delete.** Refusing an
  oversize web copy by throwing left the file in storage; the refusal is a
  return value now, and the test asserts the file is gone.
- **Four nav links overflow a phone's header row** into the exit control. The
  page links now scroll sideways when they must.

## Before the event

- [ ] **Spike on a real iPhone over cellular**: pick ten photos, watch the
      direct PUT to Drive succeed. If it fails, the fallback is uploading
      originals through a Convex HTTP action (20 MB cap per file).
- [ ] The hosts' Google Cloud OAuth screen must be set to **In production**,
      not Testing, or the refresh token expires after seven days.
- [ ] Testing so far is light, not at event load. Convex's free tier includes
      1 GB of file bandwidth a month; a busy day of scrolling could approach it.
