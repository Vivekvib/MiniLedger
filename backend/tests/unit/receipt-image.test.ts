import {
  MAX_RECEIPT_BASE64_LENGTH,
  MAX_RECEIPT_BYTES,
  RECEIPT_CONTENT_TYPES,
  RECEIPT_REQUEST_LIMIT_BYTES,
  decodeReceipt,
  hasImageSignature,
  type ReceiptContentType,
} from '../../src/utils/receipt-image';

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const HEADS: Record<ReceiptContentType, Buffer> = {
  'image/jpeg': JPEG_HEAD,
  'image/png': PNG_HEAD,
  'image/webp': WEBP_HEAD,
};

describe('hasImageSignature', () => {
  it.each(RECEIPT_CONTENT_TYPES)('accepts a real %s header', (type) => {
    expect(hasImageSignature(type, HEADS[type])).toBe(true);
  });

  it.each(RECEIPT_CONTENT_TYPES)('rejects the other two formats under the %s label', (type) => {
    for (const other of RECEIPT_CONTENT_TYPES) {
      if (other !== type) expect(hasImageSignature(type, HEADS[other])).toBe(false);
    }
  });

  it('rejects text, HTML, SVG, PDF, GIF and empty or truncated input', () => {
    const samples = [
      Buffer.from('hello world, not an image'),
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      Buffer.from('%PDF-1.7'),
      Buffer.from('GIF89a'),
      Buffer.alloc(0),
      Buffer.from([0xff, 0xd8]), // JPEG needs three bytes
      Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG needs eight
      Buffer.from('RIFF....WAVE'), // RIFF, but audio
    ];
    for (const bytes of samples) {
      for (const type of RECEIPT_CONTENT_TYPES) expect(hasImageSignature(type, bytes)).toBe(false);
    }
  });
});

describe('decodeReceipt', () => {
  const filler = (head: Buffer, total: number) => Buffer.concat([head, Buffer.alloc(total - head.length, 7)]);

  it.each(RECEIPT_CONTENT_TYPES)('decodes a %s to exactly the original bytes', (type) => {
    const original = filler(HEADS[type], 300);
    const result = decodeReceipt(type, original.toString('base64'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.bytes.equals(original)).toBe(true);
  });

  it('accepts base64 with 0, 1 and 2 padding characters', () => {
    for (const total of [30, 31, 32]) {
      const original = filler(JPEG_HEAD, total);
      const text = original.toString('base64');
      expect(decodeReceipt('image/jpeg', text).ok).toBe(true);
    }
  });

  it('ignores whitespace around the text but not inside it', () => {
    const text = filler(JPEG_HEAD, 60).toString('base64');
    expect(decodeReceipt('image/jpeg', `  ${text}\n`).ok).toBe(true);
    expect(decodeReceipt('image/jpeg', `${text.slice(0, 8)}\n${text.slice(8)}`)).toEqual({ ok: false, reason: 'format' });
  });

  it('reports an empty value', () => {
    expect(decodeReceipt('image/jpeg', '')).toEqual({ ok: false, reason: 'empty' });
    expect(decodeReceipt('image/jpeg', '   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it.each([
    ['characters outside the base64 alphabet', 'not base64 at all!!'],
    ['URL-safe base64 characters', '_-_-_-_-'],
    ['a length that is not a multiple of 4', '/9j/4AA'],
    ['padding in the middle', '/9j=/4AA'],
    ['more than two padding characters', '/9j/4==='],
    ['a data: URL instead of bare base64', 'data:image/jpeg;base64,/9j/4AAQ'],
  ])('rejects %s as malformed', (_label, text) => {
    expect(decodeReceipt('image/jpeg', text)).toEqual({ ok: false, reason: 'format' });
  });

  it('rejects bytes that are not the declared image type', () => {
    expect(decodeReceipt('image/jpeg', filler(PNG_HEAD, 100).toString('base64'))).toEqual({ ok: false, reason: 'not_an_image' });
    expect(decodeReceipt('image/png', Buffer.from('plain text file').toString('base64'))).toEqual({
      ok: false,
      reason: 'not_an_image',
    });
  });

  it('accepts a photo of exactly the maximum size and refuses one byte more', () => {
    const atLimit = filler(JPEG_HEAD, MAX_RECEIPT_BYTES);
    expect(decodeReceipt('image/jpeg', atLimit.toString('base64')).ok).toBe(true);

    const over = filler(JPEG_HEAD, MAX_RECEIPT_BYTES + 1);
    expect(decodeReceipt('image/jpeg', over.toString('base64'))).toEqual({ ok: false, reason: 'too_large' });
  });

  it('refuses an oversized text on length alone, before decoding it', () => {
    expect(decodeReceipt('image/jpeg', 'A'.repeat(MAX_RECEIPT_BASE64_LENGTH + 4))).toEqual({ ok: false, reason: 'too_large' });
  });
});

describe('limits are consistent with each other', () => {
  it('the base64 limit is exactly the length of the largest photo encoded', () => {
    expect(Buffer.alloc(MAX_RECEIPT_BYTES).toString('base64').length).toBe(MAX_RECEIPT_BASE64_LENGTH);
  });

  it('the request-body limit leaves room for the JSON envelope around the largest photo', () => {
    const envelope = JSON.stringify({ contentType: 'image/webp', data: '' }).length;
    expect(RECEIPT_REQUEST_LIMIT_BYTES).toBeGreaterThanOrEqual(MAX_RECEIPT_BASE64_LENGTH + envelope);
  });
});
