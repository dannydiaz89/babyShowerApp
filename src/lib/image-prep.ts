/**
 * Turning a picked photo into what the wall needs, on the guest's phone.
 *
 * Two outputs per photo: a web copy the wall shows and a small thumbnail for
 * the upload screen. Both are made from the file the browser already has,
 * so they appear before a single byte is sent. The original is untouched.
 *
 * The arithmetic is separated from the browser calls so it can be tested;
 * everything that needs a canvas is kept thin.
 */
import { PHOTO_WEB_MAX_EDGE } from "../../convex/limits";

export type Size = { width: number; height: number };

/**
 * Scale a size down so its longer edge is at most `maxEdge`, keeping the
 * proportions. Never scales up: a small photo stays its own size.
 */
export function fitWithin({ width, height }: Size, maxEdge: number): Size {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type PreparedImage = {
  /** What the wall shows. WebP where the browser can make one, else JPEG. */
  web: Blob;
  width: number;
  height: number;
  /** A small square-ish preview for the upload screen. */
  thumb: Blob;
};

const THUMB_EDGE = 320;
const WEB_QUALITY = 0.82;
const THUMB_QUALITY = 0.7;

/** Something the browser could not decode — HEIC on Android, a corrupt file. */
export class UnreadableImageError extends Error {
  constructor() {
    super("The browser could not read this image.");
    this.name = "UnreadableImageError";
  }
}

/**
 * Decode through an <img>, not createImageBitmap: the element path honours
 * EXIF orientation everywhere that matters, so a photo taken sideways is not
 * laid out sideways.
 */
async function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    if (img.naturalWidth === 0) throw new UnreadableImageError();
    return img;
  } catch {
    throw new UnreadableImageError();
  } finally {
    // The decoded bitmap lives on in the element; the URL can go at once.
    URL.revokeObjectURL(url);
  }
}

function draw(source: CanvasImageSource, size: Size): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new UnreadableImageError();
  ctx.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/**
 * Ask for WebP and check what came back: a browser that cannot encode it
 * hands over PNG instead, which would be several times larger than the JPEG
 * it should have been.
 */
function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === "image/webp") return resolve(webp);
        canvas.toBlob(
          (jpeg) => (jpeg ? resolve(jpeg) : reject(new UnreadableImageError())),
          "image/jpeg",
          quality
        );
      },
      "image/webp",
      quality
    );
  });
}

export async function prepareImage(
  file: File,
  maxEdge: number = PHOTO_WEB_MAX_EDGE
): Promise<PreparedImage> {
  const img = await decode(file);
  const natural = { width: img.naturalWidth, height: img.naturalHeight };

  const webSize = fitWithin(natural, maxEdge);
  const webCanvas = draw(img, webSize);
  const web = await encode(webCanvas, WEB_QUALITY);

  // The thumbnail comes from the web copy, not the original: far fewer
  // pixels to push through the canvas a second time.
  const thumbCanvas = draw(webCanvas, fitWithin(webSize, THUMB_EDGE));
  const thumb = await encode(thumbCanvas, THUMB_QUALITY);

  return { web, width: webSize.width, height: webSize.height, thumb };
}
