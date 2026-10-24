import * as ImagePicker from 'expo-image-picker';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import ReceiptScreen from '../../src/app/(app)/receipt/[id]';
import type { Loan, Receipt } from '../../src/types/api';
import { deferred, fail, installFakeApi, makeLoan, makeReceipt, ok } from '../helpers/fakeApi';
import { jpegBase64, pickerResult, pngBase64, textBase64 } from '../helpers/images';
import { renderApp, resetSession, signedInSession } from '../helpers/render';
import { getRouter, setParams } from '../helpers/router';

const ID = '11111111-1111-4111-8111-111111111111';
const gallery = ImagePicker.launchImageLibraryAsync as jest.Mock;
const camera = ImagePicker.launchCameraAsync as jest.Mock;

/** An in-memory backend for one loan, so the screen is tested against changing server state. */
function installServer(initial: Partial<Loan> = {}) {
  const state = {
    loan: makeLoan({ id: ID, friendName: 'Asha', amount: '1500.00', ...initial }),
    photo: Buffer.from(jpegBase64(400), 'base64') as Buffer | null,
  };
  const withReceipt = (receipt: Receipt | null): Loan => (state.loan = { ...state.loan, receipt });
  const api = installFakeApi({
    'GET /api/loans': () => ok({ loans: [state.loan] }),
    [`GET /api/loans/${ID}/receipt`]: () =>
      state.loan.receipt && state.photo
        ? { bytes: state.photo, contentType: state.loan.receipt.contentType }
        : fail(404, 'NOT_FOUND', 'Receipt not found.'),
    [`PUT /api/loans/${ID}/receipt`]: (call) => {
      const body = call.body as { contentType: Receipt['contentType']; data: string };
      state.photo = Buffer.from(body.data, 'base64');
      return ok(withReceipt(makeReceipt({ contentType: body.contentType, sizeBytes: state.photo.length, uploadedAt: '2026-10-22T09:00:00.000Z' })));
    },
    [`DELETE /api/loans/${ID}/receipt`]: () => {
      state.photo = null;
      return ok(withReceipt(null));
    },
  });
  return { api, state, withReceipt };
}

function lastAlert(spy: jest.SpyInstance) {
  const [title, message, buttons] = spy.mock.calls.at(-1) as [string, string, AlertButton[]];
  return {
    title,
    message,
    press: async (text: string) => {
      const button = buttons.find((b) => b.text === text);
      if (!button) throw new Error(`No "${text}" button in the alert`);
      await act(async () => {
        button.onPress?.();
      });
    },
  };
}

const disabled = (testID: string) => screen.getByTestId(testID).props.accessibilityState?.disabled === true;
const imageUri = () => (screen.getByTestId('receipt-image').props.source as { uri: string }).uri;
const dataUrlOf = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`;
const RECEIPT_GET = `GET /api/loans/${ID}/receipt`;

async function chooseFromGallery(base64: string) {
  gallery.mockResolvedValueOnce(pickerResult(base64));
  await fireEvent.press(screen.getByTestId('receipt-gallery-button'));
}

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  signedInSession();
  setParams({ id: ID });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  resetSession();
  setParams({});
});

describe('ReceiptScreen: loading', () => {
  it('shows a loading state until the loan list arrives', async () => {
    const gate = deferred();
    installFakeApi({ 'GET /api/loans': () => ({ ...ok({ loans: [makeLoan({ id: ID })] }), delayUntil: gate.promise }) });
    await renderApp(<ReceiptScreen />);

    expect(screen.getByTestId('loading-state')).toBeTruthy();
    gate.release();
    expect(await screen.findByTestId('no-receipt')).toBeTruthy();
  });

  it('shows an error with Try again when the loan cannot be loaded', async () => {
    let calls = 0;
    installFakeApi({
      'GET /api/loans': () => (++calls === 1 ? fail(500, 'INTERNAL_ERROR', 'Something went wrong on our side.') : ok({ loans: [makeLoan({ id: ID })] })),
    });
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByText('Something went wrong on our side.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('retry-button'));
    expect(await screen.findByTestId('no-receipt')).toBeTruthy();
  });

  it('says the loan was not found when the id is not in the list, and goes back from there', async () => {
    setParams({ id: '99999999-9999-4999-8999-999999999999' });
    installServer();
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByTestId('loan-not-found')).toBeTruthy();
    expect(screen.queryByTestId('receipt-gallery-button')).toBeNull();

    await fireEvent.press(screen.getByTestId('back-to-loans'));
    expect(getRouter().back).toHaveBeenCalledTimes(1);
  });

  it('goes back from the header arrow', async () => {
    installServer();
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await fireEvent.press(screen.getByTestId('back-button'));
    expect(getRouter().back).toHaveBeenCalledTimes(1);
  });
});

describe('ReceiptScreen: a loan without a receipt', () => {
  it('invites the user to add one, with the loan named, and offers no Remove', async () => {
    installServer();
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByTestId('no-receipt')).toBeTruthy();
    expect(screen.getByText('Asha')).toBeTruthy();
    expect(screen.getByText('₹1,500.00')).toBeTruthy();
    expect(screen.getByTestId('receipt-camera-button')).toBeTruthy();
    expect(screen.getByTestId('receipt-gallery-button')).toBeTruthy();
    expect(screen.queryByTestId('receipt-image')).toBeNull();
    expect(screen.queryByTestId('remove-receipt-button')).toBeNull();
  });

  it('uploads a photo as soon as it is chosen and then shows it', async () => {
    const { api } = installServer();
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    const data = jpegBase64(2000);
    await chooseFromGallery(data);

    expect(await screen.findByTestId('receipt-image')).toBeTruthy();
    const [put] = api.callsTo(`PUT /api/loans/${ID}/receipt`);
    expect(put?.body).toEqual({ contentType: 'image/jpeg', data });
    expect(put?.headers.Authorization).toBe('Bearer jwt-token-for-tests');
    expect(screen.getByText('Receipt saved.')).toBeTruthy();
    expect(screen.queryByTestId('no-receipt')).toBeNull();
    expect(screen.getByTestId('remove-receipt-button')).toBeTruthy();
    // The list is refetched so it now reports the receipt.
    expect(api.callsTo('GET /api/loans').length).toBeGreaterThanOrEqual(2);
  });

  it('uploads a photo taken with the camera', async () => {
    const { api } = installServer();
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    camera.mockResolvedValueOnce(pickerResult(pngBase64(800)));
    await fireEvent.press(screen.getByTestId('receipt-camera-button'));

    await screen.findByTestId('receipt-image');
    expect((api.callsTo(`PUT /api/loans/${ID}/receipt`)[0]?.body as { contentType: string }).contentType).toBe('image/png');
  });

  it('shows the photo as "Uploading…" and locks the buttons while the upload runs', async () => {
    const gate = deferred();
    const server = installServer();
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => ({ ...ok(server.withReceipt(makeReceipt())), delayUntil: gate.promise }));
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(jpegBase64(500));

    expect(await screen.findByText('Uploading…')).toBeTruthy();
    expect(screen.getByTestId('receipt-draft')).toBeTruthy();
    expect(disabled('receipt-camera-button')).toBe(true);
    expect(disabled('receipt-gallery-button')).toBe(true);

    gate.release();
    await screen.findByTestId('receipt-image');
    expect(screen.queryByText('Uploading…')).toBeNull();
    expect(disabled('receipt-gallery-button')).toBe(false);
  });

  it('refuses a too-large photo on the phone, and sends nothing', async () => {
    const { api } = installServer();
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(jpegBase64(6 * 1024 * 1024));

    expect((await screen.findByTestId('receipt-picker-error')).props.children).toMatch(/too large/);
    expect(api.callsTo(`PUT /api/loans/${ID}/receipt`)).toHaveLength(0);
    expect(screen.getByTestId('no-receipt')).toBeTruthy();
  });

  it('refuses a file that is not an image, and sends nothing', async () => {
    const { api } = installServer();
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(textBase64());

    expect((await screen.findByTestId('receipt-picker-error')).props.children).toMatch(/JPEG, PNG or WebP/);
    expect(api.callsTo(`PUT /api/loans/${ID}/receipt`)).toHaveLength(0);
  });
});

describe('ReceiptScreen: a failed upload', () => {
  it('keeps the photo on screen, says it was not uploaded, and retries with the same photo', async () => {
    const server = installServer();
    let attempts = 0;
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => {
      if (++attempts === 1) return fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
      return ok(server.withReceipt(makeReceipt()));
    });
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    const data = jpegBase64(700);
    await chooseFromGallery(data);

    expect(await screen.findByText(/The receipt was not uploaded\. Something went wrong/)).toBeTruthy();
    expect(screen.getByText('Not uploaded yet')).toBeTruthy();
    expect(screen.getByTestId('receipt-draft')).toBeTruthy();
    expect(screen.queryByTestId('receipt-image')).toBeNull();

    await fireEvent.press(screen.getByText('Try again'));

    await screen.findByTestId('receipt-image');
    const puts = server.api.callsTo(`PUT /api/loans/${ID}/receipt`);
    expect(puts).toHaveLength(2);
    expect(puts[1]?.body).toEqual(puts[0]?.body);
    expect(puts[1]?.body).toEqual({ contentType: 'image/jpeg', data });
    expect(screen.getByText('Receipt saved.')).toBeTruthy();
    expect(screen.queryByTestId('receipt-draft')).toBeNull();
  });

  it('explains a network failure in plain words', async () => {
    const server = installServer();
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => {
      throw new Error('offline');
    });
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(jpegBase64(300));

    expect(await screen.findByText(/The receipt was not uploaded\. Can't reach the server/)).toBeTruthy();
  });

  it('shows the server\'s own message when it refuses the photo', async () => {
    const server = installServer();
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => fail(404, 'NOT_FOUND', 'Loan not found.'));
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(jpegBase64(300));

    expect(await screen.findByText('The receipt was not uploaded. Loan not found.')).toBeTruthy();
  });

  it('discards the unsent photo with Dismiss', async () => {
    const server = installServer();
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'));
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('no-receipt');

    await chooseFromGallery(jpegBase64(300));
    await screen.findByTestId('receipt-draft');
    await fireEvent.press(screen.getByText('Dismiss'));

    expect(screen.queryByTestId('receipt-draft')).toBeNull();
    expect(screen.queryByTestId('receipt-notice')).toBeNull();
    expect(screen.getByTestId('no-receipt')).toBeTruthy();
  });

  it('keeps showing the old receipt after a failed replacement', async () => {
    const server = installServer({ receipt: makeReceipt({ sizeBytes: 5000 }) });
    server.api.on(`PUT /api/loans/${ID}/receipt`, () => fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'));
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('receipt-image');

    await chooseFromGallery(pngBase64(400));
    await screen.findByText(/not uploaded/);
    await fireEvent.press(screen.getByText('Dismiss'));

    expect(screen.getByTestId('receipt-image')).toBeTruthy();
    expect(screen.getByTestId('receipt-meta').props.children.join('')).toMatch(/^JPEG · 5 KB/);
  });
});

describe('ReceiptScreen: a loan with a receipt', () => {
  it('downloads the photo with the Bearer token and shows exactly those bytes, with its details', async () => {
    const { api, state } = installServer({ receipt: makeReceipt({ contentType: 'image/png', sizeBytes: 123_456, uploadedAt: '2026-10-21T10:00:00.000Z' }) });
    await renderApp(<ReceiptScreen />);

    await screen.findByTestId('receipt-image');
    expect(imageUri()).toBe(dataUrlOf('image/png', state.photo!));
    const [get] = api.callsTo(RECEIPT_GET);
    expect(get?.headers.Authorization).toBe('Bearer jwt-token-for-tests');
    expect(api.callsTo(RECEIPT_GET)).toHaveLength(1);
    expect(screen.getByLabelText('Receipt photo for the loan to Asha')).toBeTruthy();
    expect(screen.getByTestId('receipt-meta').props.children.join('')).toBe('PNG · 121 KB · Added 21 Oct 2026');
    expect(screen.queryByTestId('no-receipt')).toBeNull();
    expect(screen.queryByTestId('receipt-image-loading')).toBeNull();
  });

  it('shows "Loading receipt…" while the photo downloads', async () => {
    const gate = deferred();
    const server = installServer({ receipt: makeReceipt() });
    server.api.on(RECEIPT_GET, () => ({ bytes: server.state.photo!, contentType: 'image/jpeg', delayUntil: gate.promise }));
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByTestId('receipt-image-loading')).toBeTruthy();
    expect(screen.getByText('Loading receipt…')).toBeTruthy();
    expect(screen.queryByTestId('receipt-image')).toBeNull();

    gate.release();
    expect(await screen.findByTestId('receipt-image')).toBeTruthy();
    expect(screen.queryByTestId('receipt-image-loading')).toBeNull();
  });

  it('says WHY the photo could not be downloaded, and Try again fetches it again', async () => {
    const server = installServer({ receipt: makeReceipt() });
    let attempts = 0;
    server.api.on(RECEIPT_GET, () =>
      ++attempts <= 1
        ? fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.')
        : { bytes: server.state.photo!, contentType: 'image/jpeg' },
    );
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByTestId('receipt-image-error')).toBeTruthy();
    expect(screen.getByText("Couldn't load the receipt photo. Something went wrong. Please try again.")).toBeTruthy();
    expect(screen.queryByTestId('receipt-image')).toBeNull();
    // The empty box shows no endless spinner next to the error.
    expect(screen.queryByText('Loading receipt…')).toBeNull();

    await fireEvent.press(screen.getByText('Try again'));

    expect(await screen.findByTestId('receipt-image')).toBeTruthy();
    expect(screen.queryByTestId('receipt-image-error')).toBeNull();
  });

  it('names a network failure in plain words', async () => {
    const server = installServer({ receipt: makeReceipt() });
    server.api.on(RECEIPT_GET, () => {
      throw new Error('Network request failed');
    });
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByText(/Couldn't load the receipt photo\. Can't reach the server/)).toBeTruthy();
  });

  it('keeps the rest of the screen usable when the photo cannot be downloaded', async () => {
    const server = installServer({ receipt: makeReceipt() });
    server.api.on(RECEIPT_GET, () => fail(404, 'NOT_FOUND', 'Receipt not found.'));
    await renderApp(<ReceiptScreen />);

    await screen.findByTestId('receipt-image-error');
    expect(screen.getByTestId('receipt-gallery-button')).toBeTruthy();
    expect(screen.getByTestId('remove-receipt-button')).toBeTruthy();
  });

  it('offers a retry when the photo downloaded but cannot be drawn', async () => {
    const { api } = installServer({ receipt: makeReceipt() });
    await renderApp(<ReceiptScreen />);
    const image = await screen.findByTestId('receipt-image');

    await fireEvent(image, 'error');
    expect(await screen.findByTestId('receipt-image-decode-error')).toBeTruthy();
    expect(screen.getByText('The photo was downloaded but could not be displayed.')).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));

    await waitFor(() => expect(api.callsTo(RECEIPT_GET)).toHaveLength(2));
    expect(screen.queryByTestId('receipt-image-decode-error')).toBeNull();
    expect(screen.getByTestId('receipt-image')).toBeTruthy();
  });

  it('replaces the receipt: uploads the new photo and shows the new details', async () => {
    const { api } = installServer({ receipt: makeReceipt({ sizeBytes: 5000 }) });
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('receipt-image');
    const before = imageUri();

    await chooseFromGallery(pngBase64(900));

    expect(await screen.findByText('Receipt replaced.')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('receipt-meta').props.children.join('')).toMatch(/^PNG · 900 B/));
    expect(api.callsTo(`PUT /api/loans/${ID}/receipt`)).toHaveLength(1);
    // The NEW photo is downloaded; a cached copy of the old one is never shown.
    await waitFor(() => expect(imageUri()).toBe(dataUrlOf('image/png', Buffer.from(pngBase64(900), 'base64'))));
    expect(imageUri()).not.toBe(before);
    expect(api.callsTo(RECEIPT_GET)).toHaveLength(2);
  });

  it('asks before removing, and removing nothing when cancelled', async () => {
    const { api } = installServer({ receipt: makeReceipt() });
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('receipt-image');

    await fireEvent.press(screen.getByTestId('remove-receipt-button'));
    const alert = lastAlert(alertSpy);
    expect(alert.title).toBe('Remove this receipt?');
    await alert.press('Cancel');

    expect(api.callsTo(`DELETE /api/loans/${ID}/receipt`)).toHaveLength(0);
    expect(screen.getByTestId('receipt-image')).toBeTruthy();
  });

  it('removes the receipt once confirmed, then invites adding another', async () => {
    const { api } = installServer({ receipt: makeReceipt() });
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('receipt-image');

    await fireEvent.press(screen.getByTestId('remove-receipt-button'));
    await lastAlert(alertSpy).press('Remove');

    expect(await screen.findByText('Receipt removed.')).toBeTruthy();
    await screen.findByTestId('no-receipt');
    expect(api.callsTo(`DELETE /api/loans/${ID}/receipt`)).toHaveLength(1);
    expect(screen.queryByTestId('receipt-image')).toBeNull();
    expect(screen.queryByTestId('remove-receipt-button')).toBeNull();
  });

  it('keeps the receipt and says so when removal fails', async () => {
    const server = installServer({ receipt: makeReceipt() });
    server.api.on(`DELETE /api/loans/${ID}/receipt`, () => fail(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.'));
    await renderApp(<ReceiptScreen />);
    await screen.findByTestId('receipt-image');

    await fireEvent.press(screen.getByTestId('remove-receipt-button'));
    await lastAlert(alertSpy).press('Remove');

    expect(await screen.findByText('The receipt was not removed. Something went wrong. Please try again.')).toBeTruthy();
    expect(screen.getByTestId('receipt-image')).toBeTruthy();
  });

  it('works on a repaid loan too', async () => {
    installServer({ status: 'repaid', repaidAt: '2026-10-20T10:00:00.000Z', receipt: makeReceipt() });
    await renderApp(<ReceiptScreen />);

    expect(await screen.findByTestId('receipt-image')).toBeTruthy();
    expect(screen.getByTestId('receipt-gallery-button')).toBeTruthy();
    expect(screen.getByTestId('remove-receipt-button')).toBeTruthy();
  });
});
