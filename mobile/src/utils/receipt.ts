import type { ReceiptContentType } from '../types/api';

/**
 * Receipt photos: what the phone checks before uploading. The server checks all of this again
 * (and is the authority); these checks exist so the user hears about a problem immediately,
 * instead of after waiting for a multi-megabyte upload to be refused.
 */

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

/** A photo that passed the phone-side checks, ready to show and to upload. */
export interface PickedReceipt {
  /** Local file URI, used for the preview only. */
  uri: string;
  contentType: ReceiptContentType;
  /** Plain base64, no `data:` prefix. */
  data: string;
  sizeBytes: number;
}

export const RECEIPT_MESSAGES = {
  unreadable: "We couldn't read that photo. Please try another one.",
  unsupported: "That file type isn't supported. Choose a JPEG, PNG or WebP photo.",
  tooLarge: (bytes: number) =>
    `That photo is too large (${formatFileSize(bytes)}). The maximum is ${formatFileSize(RECEIPT_MAX_BYTES)}. Try a smaller photo.`,
} as const;

/** Decoded size of a base64 string, without decoding it. */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** The image type from the first characters of the base64 text (the file's magic bytes), or null. */
export function detectReceiptType(base64: string): ReceiptContentType | null {
  if (base64.startsWith('/9j/')) return 'image/jpeg'; // FF D8 FF
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png'; // 89 50 4E 47 0D 0A 1A 0A
  if (base64.startsWith('UklGR')) return 'image/webp'; // "RIFF" (the server also checks for "WEBP")
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const megabytes = bytes / (1024 * 1024);
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)} MB`;
}

export function receiptTypeLabel(type: ReceiptContentType): string {
  return type === 'image/jpeg' ? 'JPEG' : type === 'image/png' ? 'PNG' : 'WebP';
}

export type PrepareResult = { ok: true; receipt: PickedReceipt } | { ok: false; message: string };

/** Turns what the picker returned into a PickedReceipt, or says in words why it can't be used. */
export function prepareReceipt(asset: { uri: string; base64?: string | null }): PrepareResult {
  const data = asset.base64?.replace(/\s+/g, '') ?? '';
  if (data === '') return { ok: false, message: RECEIPT_MESSAGES.unreadable };

  const contentType = detectReceiptType(data);
  if (contentType === null) return { ok: false, message: RECEIPT_MESSAGES.unsupported };

  const sizeBytes = base64ByteLength(data);
  if (sizeBytes > RECEIPT_MAX_BYTES) return { ok: false, message: RECEIPT_MESSAGES.tooLarge(sizeBytes) };

  return { ok: true, receipt: { uri: asset.uri, contentType, data, sizeBytes } };
}
