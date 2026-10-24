import {
  RECEIPT_MAX_BYTES,
  RECEIPT_MESSAGES,
  base64ByteLength,
  detectReceiptType,
  formatFileSize,
  prepareReceipt,
  receiptTypeLabel,
} from '../../src/utils/receipt';
import { jpegBase64, pngBase64, textBase64, webpBase64 } from '../helpers/images';

describe('base64ByteLength', () => {
  it.each([1, 2, 3, 4, 5, 100, 301, 4096])('matches the real decoded size for %i bytes', (size) => {
    const bytes = Buffer.alloc(size, 1);
    expect(base64ByteLength(bytes.toString('base64'))).toBe(size);
  });

  it('is zero for an empty string', () => {
    expect(base64ByteLength('')).toBe(0);
  });
});

describe('detectReceiptType', () => {
  it('recognises JPEG, PNG and WebP by their first bytes', () => {
    expect(detectReceiptType(jpegBase64())).toBe('image/jpeg');
    expect(detectReceiptType(pngBase64())).toBe('image/png');
    expect(detectReceiptType(webpBase64())).toBe('image/webp');
  });

  it.each([
    ['text', textBase64()],
    ['a PDF', Buffer.from('%PDF-1.7 ....').toString('base64')],
    ['a GIF', Buffer.from('GIF89a......').toString('base64')],
    ['an SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')],
    ['nothing', ''],
  ])('refuses %s', (_label, data) => {
    expect(detectReceiptType(data)).toBeNull();
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1024, '1 KB'],
    [812 * 1024, '812 KB'],
    [1.5 * 1024 * 1024, '1.5 MB'],
    [RECEIPT_MAX_BYTES, '5.0 MB'],
    [12 * 1024 * 1024, '12 MB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('receiptTypeLabel', () => {
  it('uses readable names', () => {
    expect(receiptTypeLabel('image/jpeg')).toBe('JPEG');
    expect(receiptTypeLabel('image/png')).toBe('PNG');
    expect(receiptTypeLabel('image/webp')).toBe('WebP');
  });
});

describe('prepareReceipt', () => {
  it('accepts a photo and reports its type, exact size and local uri', () => {
    const result = prepareReceipt({ uri: 'file:///a.jpg', base64: jpegBase64(1234) });
    expect(result).toEqual({
      ok: true,
      receipt: { uri: 'file:///a.jpg', contentType: 'image/jpeg', data: jpegBase64(1234), sizeBytes: 1234 },
    });
  });

  it('strips whitespace some pickers add to the base64 text', () => {
    const data = jpegBase64(60);
    const result = prepareReceipt({ uri: 'file:///a.jpg', base64: `${data.slice(0, 20)}\n${data.slice(20)}\r\n` });
    expect(result.ok && result.receipt.data).toBe(data);
  });

  it.each([null, undefined, '', '   '])('says the photo could not be read when base64 is %j', (base64) => {
    expect(prepareReceipt({ uri: 'file:///a.jpg', base64 })).toEqual({ ok: false, message: RECEIPT_MESSAGES.unreadable });
  });

  it('refuses a file that is not a JPEG, PNG or WebP image', () => {
    expect(prepareReceipt({ uri: 'file:///a.txt', base64: textBase64() })).toEqual({
      ok: false,
      message: RECEIPT_MESSAGES.unsupported,
    });
  });

  it('accepts exactly 5 MB and refuses one byte more, naming both sizes', () => {
    expect(prepareReceipt({ uri: 'u', base64: jpegBase64(RECEIPT_MAX_BYTES) }).ok).toBe(true);

    const over = prepareReceipt({ uri: 'u', base64: jpegBase64(RECEIPT_MAX_BYTES + 1) });
    expect(over.ok).toBe(false);
    expect(!over.ok && over.message).toBe('That photo is too large (5.0 MB). The maximum is 5.0 MB. Try a smaller photo.');
  });

  it('tells the user the real size of a very large photo', () => {
    const result = prepareReceipt({ uri: 'u', base64: jpegBase64(12 * 1024 * 1024) });
    expect(!result.ok && result.message).toBe('That photo is too large (12 MB). The maximum is 5.0 MB. Try a smaller photo.');
  });
});
