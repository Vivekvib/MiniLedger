import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import LoginScreen from '../../src/app/(auth)/login';
import { SESSION_EXPIRED_MESSAGE } from '../../src/context/AuthContext';
import { PHONE_ERROR } from '../../src/utils/phone';
import { deferred, fail, installFakeApi, ok } from '../helpers/fakeApi';
import { renderApp, resetSession } from '../helpers/render';
import { getRouter } from '../helpers/router';

const OTP_SENT = { expiresInSeconds: 300, resendAfterSeconds: 60 };

async function typePhone(text: string) {
  await fireEvent.changeText(screen.getByTestId('phone-input'), text);
}

async function pressSend() {
  await fireEvent.press(screen.getByTestId('send-code-button'));
}

afterEach(() => resetSession());

describe('LoginScreen', () => {
  it('explains what the app is and that sign-in is a development mock', async () => {
    installFakeApi();
    await renderApp(<LoginScreen />);

    expect(screen.getByText('MiniLedger')).toBeTruthy();
    expect(screen.getByLabelText('Mobile number')).toBeTruthy();
    expect(screen.getByTestId('dev-hint')).toBeTruthy();
    expect(screen.getByTestId('dev-hint')).toHaveTextContent(/printed in the terminal/i);
  });

  it('refuses an empty number next to the field and sends nothing', async () => {
    const api = installFakeApi();
    await renderApp(<LoginScreen />);

    await pressSend();

    expect(screen.getByTestId('phone-input-error').props.children).toBe(PHONE_ERROR);
    expect(api.calls).toHaveLength(0);
    expect(getRouter().push).not.toHaveBeenCalled();
  });

  it('refuses a malformed number, and clears the message as soon as the user edits it', async () => {
    const api = installFakeApi();
    await renderApp(<LoginScreen />);

    await typePhone('12345');
    await pressSend();
    expect(screen.getByTestId('phone-input-error')).toBeTruthy();
    expect(api.calls).toHaveLength(0);

    await typePhone('123456');
    expect(screen.queryByTestId('phone-input-error')).toBeNull();
  });

  it('normalises a 10-digit number to +91, requests a code and goes to the verify screen', async () => {
    const api = installFakeApi({ 'POST /api/auth/request-otp': () => ok(OTP_SENT) });
    await renderApp(<LoginScreen />);

    await typePhone('12345 67890');
    await pressSend();

    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    expect(api.callsTo('POST /api/auth/request-otp')).toHaveLength(1);
    expect(api.callsTo('POST /api/auth/request-otp')[0]?.body).toEqual({ phone: '+911234567890' });
    expect(getRouter().push).toHaveBeenCalledWith({
      pathname: '/verify',
      params: { phone: '+911234567890', resendAfter: '60' },
    });
  });

  it('can be submitted with the keyboard "send" key', async () => {
    const api = installFakeApi({ 'POST /api/auth/request-otp': () => ok(OTP_SENT) });
    await renderApp(<LoginScreen />);

    await typePhone('+91 98765 43210');
    await fireEvent(screen.getByTestId('phone-input'), 'submitEditing');

    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    expect(api.callsTo('POST /api/auth/request-otp')[0]?.body).toEqual({ phone: '+919876543210' });
  });

  it('ignores a second tap while the first request is still in flight', async () => {
    const gate = deferred();
    const api = installFakeApi({ 'POST /api/auth/request-otp': () => ({ ...ok(OTP_SENT), delayUntil: gate.promise }) });
    await renderApp(<LoginScreen />);

    await typePhone('1234567890');
    await pressSend();
    await pressSend();
    await pressSend();

    expect(api.callsTo('POST /api/auth/request-otp')).toHaveLength(1);
    expect(screen.getByTestId('send-code-button').props.accessibilityState).toMatchObject({ busy: true, disabled: true });

    gate.release();
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('send-code-button').props.accessibilityState).toMatchObject({ busy: false });
  });

  it('shows a plain message and stays on the screen when the server cannot be reached', async () => {
    installFakeApi({
      'POST /api/auth/request-otp': () => {
        throw new TypeError('Network request failed');
      },
    });
    await renderApp(<LoginScreen />);

    await typePhone('1234567890');
    await pressSend();

    expect(await screen.findByTestId('request-error')).toBeTruthy();
    expect(getRouter().push).not.toHaveBeenCalled();
    // The button is usable again so the user can retry.
    expect(screen.getByTestId('send-code-button').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('shows the throttle message with the wait time when too many codes were requested', async () => {
    installFakeApi({
      'POST /api/auth/request-otp': () =>
        fail(429, 'OTP_REQUEST_LIMIT', 'Too many codes requested.', { retryAfterSeconds: 1800 }),
    });
    await renderApp(<LoginScreen />);

    await typePhone('1234567890');
    await pressSend();

    const banner = await screen.findByTestId('request-error');
    expect(banner).toHaveTextContent('Too many codes requested. Try again in 30 minutes.');
    expect(getRouter().push).not.toHaveBeenCalled();
  });

  it('goes to the verify screen when a code was sent a moment ago (resend too soon) with the remaining wait', async () => {
    installFakeApi({
      'POST /api/auth/request-otp': () =>
        fail(429, 'OTP_RESEND_TOO_SOON', 'Wait before requesting another code.', { retryAfterSeconds: 37 }),
    });
    await renderApp(<LoginScreen />);

    await typePhone('1234567890');
    await pressSend();

    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    expect(getRouter().push).toHaveBeenCalledWith({
      pathname: '/verify',
      params: { phone: '+911234567890', resendAfter: '37' },
    });
    expect(screen.queryByTestId('request-error')).toBeNull();
  });

  it('shows the "session expired" notice after a forced sign-out, and lets the user dismiss it', async () => {
    jest.requireMock('expo-secure-store').__store.set('miniledger.access_token', 'revoked');
    installFakeApi({ 'GET /api/auth/me': () => fail(401, 'UNAUTHORIZED', 'Authentication required.') });
    await renderApp(<LoginScreen />);

    const notice = await screen.findByTestId('session-notice');
    expect(notice).toHaveTextContent(SESSION_EXPIRED_MESSAGE, { exact: false });

    await fireEvent.press(screen.getByLabelText('Dismiss'));
    await waitFor(() => expect(screen.queryByTestId('session-notice')).toBeNull());
  });
});
