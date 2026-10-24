/**
 * Validation for uploaded receipt photos.
 *
 * The app sends the photo as base64 text inside a JSON body. Everything about it is checked here
 * before it is stored: it must be strict base64, within the size limit, and its first bytes must
 * really be a JPEG, PNG or WebP image. The declared content type is never trusted on its own, so
 * a text file, an SVG (which can carry scripts) or an executable renamed "photo.jpg" is refused.
 */

export const RECEIPT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ReceiptContentType = (typeof RECEIPT_CONTENT_TYPES)[number];

/** The largest photo accepted, in bytes after decoding: 5 MiB. */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Base64 text for the largest photo: 4 characters for every 3 bytes, padding included. */
export const MAX_RECEIPT_BASE64_LENGTH = 4 * Math.ceil(MAX_RECEIPT_BYTES / 3);

/** The largest JSON body the upload route reads: the base64 text plus room for the envelope. */
export const RECEIPT_REQUEST_LIMIT_BYTES = MAX_RECEIPT_BASE64_LENGTH + 1024;

export type ReceiptDecodeFailure = 'empty' | 'format' | 'too_large' | 'not_an_image';

export type ReceiptDecodeResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; reason: ReceiptDecodeFailure };

const LABELS: Record<ReceiptContentType, string> = {
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

export const RECEIPT_MESSAGES = {
  empty: 'The image is empty.',
  format: 'The image data must be base64 text.',
  too_large: `The image is too large. The maximum size is ${MAX_RECEIPT_BYTES / (1024 * 1024)} MB.`,
  not_an_image: (type: ReceiptContentType) => `The file is not a valid ${LABELS[type]} image.`,
} as const;

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** True when `bytes` begins with the file signature ("magic number") of the given image type. */
export function hasImageSignature(type: ReceiptContentType, bytes: Buffer): boolean {
  switch (type) {
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/png':
      return (
        bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      );
    case 'image/webp':
      // "RIFF" <4 size bytes> "WEBP"
      return bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP';
  }
}

/**
 * Turns the base64 text into bytes, or says why it cannot. The length is checked BEFORE decoding,
 * so an oversized upload costs almost nothing to refuse.
 */
export function decodeReceipt(type: ReceiptContentType, base64: string): ReceiptDecodeResult {
  const text = base64.trim();
  if (text === '') return { ok: false, reason: 'empty' };
  if (text.length > MAX_RECEIPT_BASE64_LENGTH) return { ok: false, reason: 'too_large' };
  if (text.length % 4 !== 0 || !BASE64.test(text)) return { ok: false, reason: 'format' };

  const bytes = Buffer.from(text, 'base64');
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  if (bytes.length > MAX_RECEIPT_BYTES) return { ok: false, reason: 'too_large' };
  if (!hasImageSignature(type, bytes)) return { ok: false, reason: 'not_an_image' };

  return { ok: true, bytes };
}
