import * as ImagePicker from 'expo-image-picker';
import { prepareReceipt, type PickedReceipt } from '../utils/receipt';

/**
 * Camera and gallery access for receipt photos.
 *
 * Quality 0.6 re-encodes the photo as a JPEG a fraction of the size of the original: a receipt
 * stays perfectly readable, and a modern phone photo stays far below the 5 MB limit.
 * `base64: true` returns the bytes alongside the file URI, so nothing else has to read the file.
 */

export type PickOutcome =
  | { status: 'picked'; receipt: PickedReceipt }
  | { status: 'cancelled' }
  | { status: 'error'; message: string };

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.6,
  base64: true,
  allowsEditing: false,
  exif: false,
};

export const PICKER_MESSAGES = {
  cameraDenied: 'Camera access was not allowed. You can choose a photo from your gallery instead.',
  cameraBlocked:
    'Camera access is turned off for this app. Turn it on in your phone\'s settings, or choose a photo from your gallery instead.',
  cameraFailed: "Couldn't open the camera. Please try again, or choose a photo from your gallery.",
  galleryFailed: "Couldn't open your gallery. Please try again.",
} as const;

function toOutcome(result: ImagePicker.ImagePickerResult): PickOutcome {
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets[0];
  if (!asset) return { status: 'cancelled' };
  const prepared = prepareReceipt(asset);
  return prepared.ok ? { status: 'picked', receipt: prepared.receipt } : { status: 'error', message: prepared.message };
}

export async function takeReceiptPhoto(): Promise<PickOutcome> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        status: 'error',
        message: permission.canAskAgain ? PICKER_MESSAGES.cameraDenied : PICKER_MESSAGES.cameraBlocked,
      };
    }
    return toOutcome(await ImagePicker.launchCameraAsync(OPTIONS));
  } catch {
    return { status: 'error', message: PICKER_MESSAGES.cameraFailed };
  }
}

/** Android's system photo picker needs no storage permission, so there is nothing to ask for. */
export async function chooseReceiptPhoto(): Promise<PickOutcome> {
  try {
    return toOutcome(await ImagePicker.launchImageLibraryAsync(OPTIONS));
  } catch {
    return { status: 'error', message: PICKER_MESSAGES.galleryFailed };
  }
}
