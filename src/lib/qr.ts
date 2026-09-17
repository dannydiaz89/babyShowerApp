import qrcode from "qrcode-generator";

/**
 * A QR code as one SVG path, so the page that shows it can style it and the
 * hosts can hand the file to a printer.
 *
 * Geometry only, no markup: the caller renders real elements rather than
 * having a string of HTML pushed into the page.
 */

/**
 * Four empty modules on every side. Not decoration — a scanner finds the code
 * by its border, and a QR printed flush against artwork often will not read.
 */
const QUIET_ZONE = 4;

export type QrCode = {
  /** Width and height in modules, quiet zone included. Use as the viewBox. */
  size: number;
  /** One path, one square per dark module, in that coordinate space. */
  path: string;
};

/**
 * Error correction level M: about 15% of the code can be damaged and still
 * read. The step up would survive a thumbprint but costs modules, and these
 * are printed on card, not stuck to a lamppost.
 */
export function qrCode(text: string): QrCode {
  // 0 asks for the smallest version the text fits in.
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const parts: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.isDark(row, col)) {
        parts.push(`M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
      }
    }
  }

  return { size: count + QUIET_ZONE * 2, path: parts.join("") };
}
