import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AddLoanScreen from '../../src/app/(app)/add-loan';
import { useFlash } from '../../src/context/FlashContext';
import { PICKER_MESSAGES } from '../../src/services/receipt-picker';
import { deferred, fail, installFakeApi, makeLoan, makeReceipt, ok } from '../helpers/fakeApi';
import { jpegBase64, pickerResult, pngBase64, textBase64 } from '../helpers/images';
import { renderApp, resetSession, signedInSession } from '../helpers/render';
import { getRouter } from '../helpers/router';

const ID = '11111111-1111-4111-8111-111111111111';
const PUT = `PUT /api/loans/${ID}/receipt`;

const camera = ImagePicker.launchCameraAsync as jest.Mock;
const gallery = ImagePicker.launchImageLibraryAsync as jest.Mock;
const permission = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const open = DateTimePickerAndroid.open as jest.Mock;

function FlashProbe() {
  const { flash } = useFlash();
  return <Text testID="flash-probe">{flash ? `${flash.tone}:${flash.message}` : ''}</Text>;
}

const renderScreen = () =>
  renderApp(
    <>
      <AddLoanScreen />
      <FlashProbe />
    </>,
  );

async function fillForm(name = 'Asha', amount = '1500') {
  await fireEvent.changeText(screen.getByTestId('friend-name-input'), name);
  await fireEvent.changeText(screen.getByTestId('amount-input'), amount);
  await fireEvent.press(screen.getByTestId('due-date-field'));
  const options = open.mock.calls.at(-1)![0] as { onValueChange: (event: unknown, date: Date) => void };
  await act(async () => {
    options.onValueChange({}, new Date(2026, 10, 1));
  });
}

const save = () => fireEvent.press(screen.getByTestId('save-loan-button'));
const flash = () => screen.getByTestId('flash-probe').props.children as string;
const isDisabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled === true;

async function chooseFromGallery(base64: string, uri = 'file:///cache/receipt.jpg') {
  gallery.mockResolvedValueOnce(pickerResult(base64, uri));
  await fireEvent.press(screen.getByTestId('add-receipt-gallery-button'));
}

beforeEach(() => {
  signedInSession();
  jest.useFakeTimers({
    now: new Date(2026, 9, 22, 14, 30),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
});

afterEach(() => {
  resetSession();
  jest.useRealTimers();
});

describe('AddLoanScreen: choosing a receipt', () => {
  it('shows the optional receipt field with both ways to add a photo, and no photo yet', async () => {
    installFakeApi();
    await renderScreen();

    expect(screen.getByText('Receipt photo (optional)')).toBeTruthy();
    expect(screen.getByTestId('add-receipt-camera-button')).toBeTruthy();
    expect(screen.getByTestId('add-receipt-gallery-button')).toBeTruthy();
    expect(screen.queryByTestId('receipt-draft')).toBeNull();
  });

  it('shows a preview with the type and size after choosing from the gallery', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(jpegBase64(2048), 'file:///cache/chosen.jpg');

    expect(await screen.findByTestId('receipt-draft')).toBeTruthy();
    expect(screen.getByText('Receipt attached')).toBeTruthy();
    expect(screen.getByText('JPEG · 2 KB')).toBeTruthy();
    expect(screen.getByLabelText('Selected receipt photo').props.source).toEqual({ uri: 'file:///cache/chosen.jpg' });
    expect(gallery).toHaveBeenCalledTimes(1);
  });

  it('takes a photo with the camera after asking for permission', async () => {
    installFakeApi();
    await renderScreen();

    camera.mockResolvedValueOnce(pickerResult(pngBase64(900), 'file:///cache/shot.png'));
    await fireEvent.press(screen.getByTestId('add-receipt-camera-button'));

    expect(await screen.findByText('PNG · 900 B')).toBeTruthy();
    expect(permission).toHaveBeenCalledTimes(1);
    expect(camera).toHaveBeenCalledTimes(1);
  });

  it('replaces the photo when another is chosen', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(jpegBase64(500));
    await screen.findByText('JPEG · 500 B');
    await chooseFromGallery(pngBase64(700));

    expect(await screen.findByText('PNG · 700 B')).toBeTruthy();
    expect(screen.queryByText('JPEG · 500 B')).toBeNull();
    expect(screen.getAllByTestId('receipt-draft')).toHaveLength(1);
  });

  it('removes the photo with Remove', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(jpegBase64(500));
    await fireEvent.press(await screen.findByTestId('receipt-draft-remove'));

    expect(screen.queryByTestId('receipt-draft')).toBeNull();
  });

  it('keeps nothing when the picker is closed without choosing', async () => {
    installFakeApi();
    await renderScreen();

    await fireEvent.press(screen.getByTestId('add-receipt-gallery-button'));

    await waitFor(() => expect(gallery).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('receipt-draft')).toBeNull();
    expect(screen.queryByTestId('add-receipt-picker-error')).toBeNull();
  });

  it('explains a photo that is too large, and attaches nothing', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(jpegBase64(6 * 1024 * 1024));

    expect((await screen.findByTestId('add-receipt-picker-error')).props.children).toMatch(/too large \(6\.0 MB\).*maximum is 5\.0 MB/);
    expect(screen.queryByTestId('receipt-draft')).toBeNull();
  });

  it('explains a file that is not an image, and attaches nothing', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(textBase64());

    expect((await screen.findByTestId('add-receipt-picker-error')).props.children).toMatch(/JPEG, PNG or WebP/);
    expect(screen.queryByTestId('receipt-draft')).toBeNull();
  });

  it('offers the gallery when camera permission is refused', async () => {
    installFakeApi();
    await renderScreen();

    permission.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'denied' });
    await fireEvent.press(screen.getByTestId('add-receipt-camera-button'));

    expect((await screen.findByTestId('add-receipt-picker-error')).props.children).toBe(PICKER_MESSAGES.cameraDenied);
    expect(camera).not.toHaveBeenCalled();
  });

  it('clears an old picker message when the next pick works', async () => {
    installFakeApi();
    await renderScreen();

    await chooseFromGallery(textBase64());
    await screen.findByTestId('add-receipt-picker-error');
    await chooseFromGallery(jpegBase64(400));

    await screen.findByTestId('receipt-draft');
    expect(screen.queryByTestId('add-receipt-picker-error')).toBeNull();
  });

  it('keeps what was typed in the form while a photo is chosen', async () => {
    installFakeApi();
    await renderScreen();

    await fillForm('Asha', '1500');
    await chooseFromGallery(jpegBase64(400));
    await screen.findByTestId('receipt-draft');

    expect(screen.getByTestId('friend-name-input').props.value).toBe('Asha');
    expect(screen.getByTestId('amount-input').props.value).toBe('1500');
  });
});

describe('AddLoanScreen: saving with a receipt', () => {
  it('creates the loan first, then uploads the photo to that loan, then goes back', async () => {
    const data = jpegBase64(1000);
    const api = installFakeApi({
      'POST /api/loans': () => ok(makeLoan({ id: ID, friendName: 'Asha' }), 201),
      [PUT]: () => ok(makeLoan({ id: ID, friendName: 'Asha', receipt: makeReceipt({ sizeBytes: 1000 }) })),
    });
    const { queryClient } = await renderScreen();
    queryClient.setQueryData(['loans'], []);

    await fillForm('Asha', '1500');
    await chooseFromGallery(data);
    await screen.findByTestId('receipt-draft');
    await save();

    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));

    // Order: POST, then PUT.
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/loans', `PUT /api/loans/${ID}/receipt`]);
    expect(api.callsTo('POST /api/loans')[0]?.body).toEqual({ friendName: 'Asha', amount: '1500', dueDate: '2026-11-01' });
    const [put] = api.callsTo(PUT);
    expect(put?.body).toEqual({ contentType: 'image/jpeg', data });
    expect(put?.headers.Authorization).toMatch(/^Bearer /);
    expect(flash()).toBe('success:Loan added with receipt: Asha.');
    expect(queryClient.getQueryState(['loans'])?.isInvalidated).toBe(true);
  });

  it('sends no upload request when no photo was chosen', async () => {
    const api = installFakeApi({ 'POST /api/loans': () => ok(makeLoan({ id: ID }), 201) });
    await renderScreen();

    await fillForm();
    await save();

    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
    expect(api.calls.map((c) => c.method)).toEqual(['POST']);
    expect(flash()).toBe('success:Loan added: Asha.');
  });

  it('sends no upload request after the photo was removed', async () => {
    const api = installFakeApi({ 'POST /api/loans': () => ok(makeLoan({ id: ID }), 201) });
    await renderScreen();

    await fillForm();
    await chooseFromGallery(jpegBase64(400));
    await fireEvent.press(await screen.findByTestId('receipt-draft-remove'));
    await save();

    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
    expect(api.callsTo(PUT)).toHaveLength(0);
  });

  it('uploads a PNG with the right content type', async () => {
    const api = installFakeApi({
      'POST /api/loans': () => ok(makeLoan({ id: ID }), 201),
      [PUT]: () => ok(makeLoan({ id: ID, receipt: makeReceipt({ contentType: 'image/png' }) })),
    });
    await renderScreen();

    await fillForm();
    await chooseFromGallery(pngBase64(500));
    await save();

    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
    expect((api.callsTo(PUT)[0]?.body as { contentType: string }).contentType).toBe('image/png');
  });

  it('does not upload anything if the loan itself is refused, and keeps the photo for the next try', async () => {
    const api = installFakeApi({
      'POST /api/loans': () => fail(400, 'VALIDATION_ERROR', 'The request is invalid.', { fields: { amount: 'Amount must be greater than 0.' } }),
    });
    await renderScreen();

    await fillForm('Asha', '1500');
    await chooseFromGallery(jpegBase64(400));
    await screen.findByTestId('receipt-draft');
    await save();

    expect(await screen.findByText('Amount must be greater than 0.')).toBeTruthy();
    expect(api.callsTo(PUT)).toHaveLength(0);
    expect(getRouter().back).not.toHaveBeenCalled();
    expect(screen.getByTestId('receipt-draft')).toBeTruthy();
  });

  it('retries after a lost connection with the same Idempotency-Key, then uploads the photo', async () => {
    let attempts = 0;
    const api = installFakeApi({
      'POST /api/loans': () => (++attempts === 1 ? fail(500, 'INTERNAL_ERROR', 'Something went wrong.') : ok(makeLoan({ id: ID }), 201)),
      [PUT]: () => ok(makeLoan({ id: ID, receipt: makeReceipt() })),
    });
    await renderScreen();

    await fillForm();
    await chooseFromGallery(jpegBase64(400));
    await save();
    await screen.findByTestId('form-error');
    expect(api.callsTo(PUT)).toHaveLength(0);

    await save();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));

    const keys = api.callsTo('POST /api/loans').map((c) => c.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(api.callsTo(PUT)).toHaveLength(1);
  });

  describe('when the loan is saved but the photo cannot be uploaded', () => {
    it('still goes back, and leaves a lasting error saying the loan WAS added and how to retry', async () => {
      const api = installFakeApi({
        'POST /api/loans': () => ok(makeLoan({ id: ID, friendName: 'Asha' }), 201),
        [PUT]: () => fail(400, 'VALIDATION_ERROR', 'The request is invalid.', { fields: { data: 'The image is too large. The maximum size is 5 MB.' } }),
      });
      await renderScreen();

      await fillForm('Asha', '1500');
      await chooseFromGallery(jpegBase64(400));
      await save();

      await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
      expect(flash()).toMatch(/^error:Loan added: Asha\. The receipt could not be uploaded: /);
      expect(flash()).toMatch(/Add receipt/);
      expect(api.callsTo('POST /api/loans')).toHaveLength(1);
      expect(api.callsTo(PUT)).toHaveLength(1);
    });

    it('says so for a network failure during the upload too', async () => {
      installFakeApi({
        'POST /api/loans': () => ok(makeLoan({ id: ID, friendName: 'Asha' }), 201),
        [PUT]: () => {
          throw new Error('network down');
        },
      });
      await renderScreen();

      await fillForm();
      await chooseFromGallery(jpegBase64(400));
      await save();

      await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
      expect(flash()).toMatch(/^error:Loan added: Asha\. The receipt could not be uploaded: Can't reach the server/);
    });

    it('refreshes the list so the new loan (without a receipt) is shown', async () => {
      installFakeApi({
        'POST /api/loans': () => ok(makeLoan({ id: ID }), 201),
        [PUT]: () => fail(500, 'INTERNAL_ERROR', 'Something went wrong.'),
      });
      const { queryClient } = await renderScreen();
      queryClient.setQueryData(['loans'], []);

      await fillForm();
      await chooseFromGallery(jpegBase64(400));
      await save();

      await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
      expect(queryClient.getQueryState(['loans'])?.isInvalidated).toBe(true);
    });
  });

  it('locks the photo controls while saving, and sends one POST and one PUT however often Save is pressed', async () => {
    const gate = deferred();
    const api = installFakeApi({
      'POST /api/loans': () => ({ ...ok(makeLoan({ id: ID }), 201), delayUntil: gate.promise }),
      [PUT]: () => ok(makeLoan({ id: ID, receipt: makeReceipt() })),
    });
    await renderScreen();

    await fillForm();
    await chooseFromGallery(jpegBase64(400));
    await save();
    await save();
    await save();

    await waitFor(() => expect(isDisabled('add-receipt-camera-button')).toBe(true));
    expect(isDisabled('add-receipt-gallery-button')).toBe(true);
    expect(isDisabled('receipt-draft-remove')).toBe(true);

    gate.release();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
    expect(api.callsTo('POST /api/loans')).toHaveLength(1);
    expect(api.callsTo(PUT)).toHaveLength(1);
  });
});
