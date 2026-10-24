/** Tiny fake photos: real file signatures followed by filler, as base64 (what the picker returns). */

const filler = (head: number[], total: number): Buffer => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, total - head.length), 7)]);

export const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00];
export const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const WEBP_HEAD = [...Buffer.from('RIFF'), 0x24, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];

export const jpegBase64 = (bytes = 300): string => filler(JPEG_HEAD, bytes).toString('base64');
export const pngBase64 = (bytes = 300): string => filler(PNG_HEAD, bytes).toString('base64');
export const webpBase64 = (bytes = 300): string => filler(WEBP_HEAD, bytes).toString('base64');
export const textBase64 = (): string => Buffer.from('this is not an image, just text').toString('base64');

/** What launchCameraAsync / launchImageLibraryAsync resolve with for one picked photo. */
export const pickerResult = (base64: string | null | undefined, uri = 'file:///cache/photo.jpg') => ({
  canceled: false as const,
  assets: [{ uri, width: 100, height: 100, base64 }],
});
