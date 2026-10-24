import * as ImagePicker from 'expo-image-picker';
import { PICKER_MESSAGES, chooseReceiptPhoto, takeReceiptPhoto } from '../../src/services/receipt-picker';
import { RECEIPT_MESSAGES } from '../../src/utils/receipt';
import { jpegBase64, pickerResult, pngBase64, textBase64 } from '../helpers/images';

const permission = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const camera = ImagePicker.launchCameraAsync as jest.Mock;
const gallery = ImagePicker.launchImageLibraryAsync as jest.Mock;

describe('takeReceiptPhoto', () => {
  it('asks for camera permission, opens the camera, and returns the prepared photo', async () => {
    camera.mockResolvedValueOnce(pickerResult(jpegBase64(500), 'file:///cache/new.jpg'));

    const outcome = await takeReceiptPhoto();

    expect(permission).toHaveBeenCalledTimes(1);
    expect(camera).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({
      status: 'picked',
      receipt: { uri: 'file:///cache/new.jpg', contentType: 'image/jpeg', data: jpegBase64(500), sizeBytes: 500 },
    });
  });

  it('asks the picker for compressed images with base64 and no editing step', async () => {
    await takeReceiptPhoto();
    expect(camera).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], quality: 0.6, base64: true, allowsEditing: false }),
    );
  });

  it('does not open the camera when permission is refused, and offers the gallery instead', async () => {
    permission.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'denied' });

    const outcome = await takeReceiptPhoto();

    expect(outcome).toEqual({ status: 'error', message: PICKER_MESSAGES.cameraDenied });
    expect(PICKER_MESSAGES.cameraDenied).toMatch(/gallery/);
    expect(camera).not.toHaveBeenCalled();
  });

  it('explains how to fix it when permission is blocked for good', async () => {
    permission.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied' });

    const outcome = await takeReceiptPhoto();

    expect(outcome).toEqual({ status: 'error', message: PICKER_MESSAGES.cameraBlocked });
    expect(PICKER_MESSAGES.cameraBlocked).toMatch(/settings/);
    expect(camera).not.toHaveBeenCalled();
  });

  it('treats a closed camera as a cancel, not an error', async () => {
    camera.mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await takeReceiptPhoto()).toEqual({ status: 'cancelled' });
  });

  it('treats a result with no assets as a cancel', async () => {
    camera.mockResolvedValueOnce({ canceled: false, assets: [] });
    expect(await takeReceiptPhoto()).toEqual({ status: 'cancelled' });
  });

  it('reports a camera that fails to open instead of throwing', async () => {
    camera.mockRejectedValueOnce(new Error('native module exploded'));
    expect(await takeReceiptPhoto()).toEqual({ status: 'error', message: PICKER_MESSAGES.cameraFailed });
  });

  it('reports a permission request that fails instead of throwing', async () => {
    permission.mockRejectedValueOnce(new Error('boom'));
    expect(await takeReceiptPhoto()).toEqual({ status: 'error', message: PICKER_MESSAGES.cameraFailed });
  });

  it('says so when the camera returned no image data', async () => {
    camera.mockResolvedValueOnce(pickerResult(null));
    expect(await takeReceiptPhoto()).toEqual({ status: 'error', message: RECEIPT_MESSAGES.unreadable });
  });
});

describe('chooseReceiptPhoto', () => {
  it('opens the gallery without asking for any permission', async () => {
    gallery.mockResolvedValueOnce(pickerResult(pngBase64(400), 'file:///cache/pick.png'));

    const outcome = await chooseReceiptPhoto();

    expect(permission).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: 'picked', receipt: { contentType: 'image/png', sizeBytes: 400 } });
  });

  it('refuses a chosen file that is not an image', async () => {
    gallery.mockResolvedValueOnce(pickerResult(textBase64()));
    expect(await chooseReceiptPhoto()).toEqual({ status: 'error', message: RECEIPT_MESSAGES.unsupported });
  });

  it('refuses a photo over 5 MB with its size in the message', async () => {
    gallery.mockResolvedValueOnce(pickerResult(jpegBase64(6 * 1024 * 1024)));
    const outcome = await chooseReceiptPhoto();
    expect(outcome.status).toBe('error');
    expect(outcome.status === 'error' && outcome.message).toMatch(/too large \(6\.0 MB\)/);
  });

  it('treats a dismissed gallery as a cancel', async () => {
    expect(await chooseReceiptPhoto()).toEqual({ status: 'cancelled' });
  });

  it('reports a gallery that fails to open', async () => {
    gallery.mockRejectedValueOnce(new Error('no activity'));
    expect(await chooseReceiptPhoto()).toEqual({ status: 'error', message: PICKER_MESSAGES.galleryFailed });
  });
});
