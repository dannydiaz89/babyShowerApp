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
  A host setting can open the wall early or close uploads while leaving the
  gallery viewable.
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
- [ ] `photos` table (status, uploader, web copy, drive id, hidden-by) with a
      `by_status` index; `photoTotals` counter row; `driveConnection` row
- [ ] `settings.photoWall` mode (`auto` / `open` / `closed`)
- [ ] `convex/photos.ts`: upload URL, create, paginated wall (live for guests,
      any filter for hosts, `mine` computed server-side), hide, restore,
      remove (deletes the web copy in the same transaction), totals
- [ ] `convex/drive.ts`: get / set / clear the Drive connection
- [ ] Tests against a real database (`tests/convex/photos.test.ts`): a
      non-owner cannot hide, hide/restore/remove keep the totals honest, the
      uploader id never appears in a wall page, remove deletes the stored file

### 2. Pure helpers
- [ ] `lib/photo-wall.ts`: is the wall open, from the mode, event date and
      a time zone — no wall clock inside
- [ ] `lib/justified.ts`: the row layout, given aspect ratios and a width
- [ ] `lib/seal.ts`: AES-GCM sealing for the Drive refresh token, keyed from
      `AUTH_SECRET`
- [ ] `lib/csp.ts`: image origin for the web copies, connect origin for Drive
- [ ] `lib/image-prep.ts`: fit-within maths (the browser half is untestable
      here and is kept thin)
- [ ] Tests for each

### 3. Server side
- [ ] `lib/google-drive.ts`: OAuth URLs, token exchange and refresh, create
      folder, open a resumable session, get and delete a file
- [ ] `lib/photos.ts`: the device cookie, page loading, the storage seam
- [ ] `/api/photos/session`, `/api/photos` (finalize), `/api/photos` (page),
      `/api/photos/[id]/hide|restore`, `DELETE /api/photos/[id]`
- [ ] `/api/google/start`, `/api/google/callback`, `/api/google/disconnect`
- [ ] Rate limits on session opens and hides
- [ ] Tests: every route refuses a caller with no session; hide checks the
      device cookie; delete is hosts-only and removes the Drive file

### 4. Guest UI
- [ ] Design system: gold callout tone, viewer surface tokens, progress bar,
      new icons — tokens in `globals.css`, primitives in `components/ui`,
      contrast pairs registered in `scripts/check-contrast.mjs`
- [ ] Strings in both languages
- [ ] "Photos" in the guest nav and the day-of banner on the invitation
- [ ] `/photos`: the wall, infinite scroll, viewer, remove
- [ ] `/photos/add`: pick, local thumbnails, name field, per-photo and overall
      progress, cancel, retry, done

### 5. Host UI
- [ ] Settings → Photos tab: wall mode, connect / disconnect Google Drive
- [ ] `/admin/photos`: all / hidden filter, restore, delete for good
- [ ] "Photos" in the host nav

### 6. Docs and checks
- [ ] README: what's here, setup for Google, security notes, known limits
- [ ] `tests/README.md`: what the new tests cover and why
- [ ] `.env.example`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- [ ] lint, typecheck, tests, contrast, build all green
- [ ] Walk through in the browser: banner, upload, wall, viewer, remove,
      host restore and delete

## Before the event

- [ ] **Spike on a real iPhone over cellular**: pick ten photos, watch the
      direct PUT to Drive succeed. If it fails, the fallback is uploading
      originals through a Convex HTTP action (20 MB cap per file).
- [ ] The hosts' Google Cloud OAuth screen must be set to **In production**,
      not Testing, or the refresh token expires after seven days.
- [ ] Testing so far is light, not at event load. Convex's free tier includes
      1 GB of file bandwidth a month; a busy day of scrolling could approach it.
