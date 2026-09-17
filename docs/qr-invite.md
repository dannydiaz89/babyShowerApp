# Invite link and QR

A link that opens the invitation without the password — `/i/<CODE>` — so the
printed cards can carry a QR. Same cookie, same month, same revocation as
typing the password: this adds a way to present the credential, not a second
kind of access.

## Decisions (settled)

- **A separate code, stored on the settings row.** Not the password in a query
  string: that leaks the shared password into logs, history and screenshots,
  cannot be revoked on its own, and dies the moment the hosts change the
  password everyone was told. Not a stateless HMAC either — revoking one would
  mean rotating `AUTH_SECRET`, which signs out every guest *and* every host,
  and leaves nothing to show in Settings for a reprint.
- **Ten characters of Crockford base32.** Fifty bits, no I/L/O/U, in front of
  the same per-address lockout the password gets. Short enough that the QR
  stays sparse and scans from a card at arm's length.
- **Stored in the clear.** The hosts have to see the link again to reprint, and
  a code they can only read once is a code they will regenerate — killing the
  cards already on the tables. It is a bearer credential in a row that already
  holds nothing the guest list does not, and rotating it is one click.
- **Its own lockout bucket**, not the password's. A guest holding an
  out-of-date card must not be able to scan themselves out of the password
  form they are about to be pointed at.
- **Rotating the code does not sign anyone out.** Printing a new card is not a
  reason to revoke sessions. Rotating the *password* still revokes every
  cookie, including ones a QR minted — and the printed card keeps working, so
  a guest just scans again. That is the right way round for paper you cannot
  recall.
- **Two codes from one link.** `/i/<CODE>` opens the invitation; the same code
  with `?next=/photos` opens the photo wall ready to upload, which is the one
  for a table card at the party. Anything else in `next` is filtered by
  `safeNext`, so a forged link is not an open redirect.
- **A route handler, not a page.** Only a handler may set a cookie, and there
  is nothing to render: every path out is a redirect, so the URL carrying the
  code is never a page anyone lingers on, screenshots, or leaks through a
  `Referer`.
- **The QR is drawn on the server**, by `qrcode-generator` (no dependencies of
  its own), and handed to the page as one SVG path. The browser bundle carries
  no encoder, and nothing pushes markup into the page. The PNG download is
  rasterised from that same drawing on a canvas rather than adding a second
  dependency.
- **The password stays printed beside the QR.** Scanning fails on older phones
  and in bad light, and the fallback costs nothing.

## What a scan does

1. `GET /i/<CODE>`, from the camera app. No cookie yet.
2. The handler checks the per-address lockout, then compares the code against
   the stored one in constant time. Settings unreadable means no mint: it
   cannot tell a good code from a revoked one, and guessing is not the way to
   find out.
3. A match clears the failure counter and sets the guest cookie on a 307 to
   `next` — `no-store`, since the answer can change between two scans.
4. A wrong code, or a lockout, goes to the gate with `?link=stale` and one
   message for both: the guest's next move is the same, and someone working
   through the code space learns nothing about when they were cut off.
5. A guest who is already signed in and scans an out-of-date card is sent
   where they were going. The dead code granted them nothing they did not
   already have, and it is not counted against them.

## Residual risk

The code travels in a URL, so it is written to the platform's request log like
any other path. That is one more reason it is rotatable rather than permanent,
and why it is a code of its own instead of the password.


Whoever holds the card is admitted, exactly as with the password printed
beside it. Guest pages show the event, the registry and the photo wall; the
guest list lives behind the admin password. A card that ends up somewhere
public is a one-click rotation, which is why the code is stored where the
hosts can replace it rather than hashed where they cannot.
