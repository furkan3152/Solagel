import { AVATAR_LIMITS, isAvatarId } from '@elymum/shared';

/**
 * "Your picture" in the coin picker: what the player can do right now, and the crop / resize of an
 * uploaded image (a square of `AVATAR_LIMITS.px`, WebP, PNG where the browser cannot encode WebP).
 */

/**
 * - `guest`: no wallet; connect one first (basic coins stay free).
 * - `verify`: a wallet but no sign-in (SIWE) session: uploads need one.
 * - `empty`: signed in, no picture yet.
 * - `ready`: signed in with a picture on the profile.
 */
export type PictureStatus = 'guest' | 'verify' | 'empty' | 'ready';

export function pictureStatus(o: { owner: string | null; token: string | null; avatar: string | null | undefined }): PictureStatus {
  if (!o.owner) return 'guest';
  if (!o.token) return 'verify';
  return isAvatarId(o.avatar) ? 'ready' : 'empty';
}

/** The coin wears the picture: the player chose it and there is one (a removed picture falls back to the basic coin). */
export function wearsPicture(chosen: boolean, avatar: string | null | undefined): boolean {
  return chosen && isAvatarId(avatar);
}

/** Files larger than this are refused before decoding (the upload itself is a few KB). */
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const SOURCE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Crop on a square stage of `stage` px: `zoom` ≥ 1 over the cover scale, `x`/`y` the image's top-left on the stage. */
export interface Crop {
  zoom: number;
  x: number;
  y: number;
}

export const MAX_ZOOM = 4;

/** Scale at which the image just covers the stage. */
export function coverScale(w: number, h: number, stage: number): number {
  return stage / Math.max(1, Math.min(w, h));
}

/** Keeps the zoom in 1..MAX_ZOOM and the image covering the whole stage. */
export function clampCrop(c: Crop, w: number, h: number, stage: number): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, Number.isFinite(c.zoom) ? c.zoom : 1));
  const s = coverScale(w, h, stage) * zoom;
  const clamp = (v: number, size: number) => Math.min(0, Math.max(stage - size * s, Number.isFinite(v) ? v : 0));
  return { zoom, x: clamp(c.x, w), y: clamp(c.y, h) };
}

/** The centre crop (what "Use picture" takes when nothing was moved). */
export function centerCrop(w: number, h: number, stage: number): Crop {
  const s = coverScale(w, h, stage);
  return { zoom: 1, x: (stage - w * s) / 2, y: (stage - h * s) / 2 };
}

/** Zooms about the stage centre. */
export function zoomCrop(c: Crop, zoom: number, w: number, h: number, stage: number): Crop {
  const base = coverScale(w, h, stage);
  const s0 = base * c.zoom;
  const next = clampCrop({ ...c, zoom }, w, h, stage);
  const s1 = base * next.zoom;
  const mid = stage / 2;
  return clampCrop({ zoom: next.zoom, x: mid - ((mid - c.x) / s0) * s1, y: mid - ((mid - c.y) / s0) * s1 }, w, h, stage);
}

/** The square of the source image the crop shows (source px). */
export function sourceRect(c: Crop, w: number, h: number, stage: number): { sx: number; sy: number; size: number } {
  const s = coverScale(w, h, stage) * c.zoom;
  const size = Math.min(stage / s, w, h);
  return { sx: Math.max(0, Math.min(w - size, -c.x / s)), sy: Math.max(0, Math.min(h - size, -c.y / s)), size };
}

/** A decoded source image (the first frame of a GIF). */
export interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

/** Why a picture cannot be used (shown to the player). */
export class PictureError extends Error {}

/** Decodes a picked file; refuses other types and huge files. */
export async function decodeFile(file: File): Promise<Source> {
  if (!SOURCE_TYPES.includes(file.type)) throw new PictureError('Pick a PNG, JPG, WebP or GIF picture.');
  if (file.size > MAX_SOURCE_BYTES) throw new PictureError('That picture is too large (15 MB at most).');
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file);
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { image: img, width: img.naturalWidth, height: img.naturalHeight, close: () => {} };
  } catch {
    throw new PictureError('That picture cannot be read.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, q));

/**
 * Cuts the crop out of the source into an `AVATAR_LIMITS.px` square and encodes it: WebP at falling
 * quality until it fits `AVATAR_LIMITS.maxBytes`, PNG where WebP is not available.
 */
export async function encodePicture(src: Source, crop: Crop, stage: number, px: number = AVATAR_LIMITS.px): Promise<Blob> {
  const { sx, sy, size } = sourceRect(crop, src.width, src.height, stage);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  if (!ctx) throw new PictureError('This browser cannot draw the picture.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src.image, sx, sy, size, size, 0, 0, px, px);
  for (const q of [0.86, 0.72, 0.55]) {
    const b = await toBlob(c, 'image/webp', q);
    if (!b || b.type !== 'image/webp') break;
    if (b.size <= AVATAR_LIMITS.maxBytes) return b;
  }
  const png = await toBlob(c, 'image/png');
  if (png && png.size <= AVATAR_LIMITS.maxBytes) return png;
  throw new PictureError('That picture is too detailed to fit. Try another one.');
}
