import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import VerifyScreen from '../../src/app/(auth)/verify';
import { OTP_ERROR } from '../../src/utils/phone';
import { deferred, fail, installFakeApi, LOGIN_RESULT, ok, USER } from '../helpers/fakeApi';
import { renderApp, resetSession } from '../helpers/render';
import { getRouter, setParams } from '../helpers/router';

const PHONE = '+911234567890';
const secureStore = () => jest.requireMock('expo-secure-store').__store as Map<string, string>;

async function typeOtp(text: string) {
  await fireEvent.changeText(screen.getByTestId('otp-input'), text);
}

async function pressVerify() {
  await fireEvent.press(screen.getByTestId('verify-button'));
}

const resendLabel = () => screen.getByTestId('resend-button').props.accessibilityLabel as string;

beforeEach(() => {
  setParams({ phone: PHONE, resendAfter: '60' });
});

afterEach(() => {
  resetSession();
  jest.useRealTimers();
});

describe('VerifyScreen', () => {
  it('shows which number the code is for', async () => {
    installFakeApi();
    await renderApp(<VerifyScreen />);
    expect(screen.getByTestId('verify-intro')).toHaveTextContent(`Enter the 6-digit code for ${PHONE}.`);
  });

  it('starts over at the login screen when it is opened without a number', async () => {
    setParams({});
    installFakeApi();
    await renderApp(<VerifyScreen />);

    expect(screen.getByTestId('redirect')).toHaveTextContent('/login');
    expect(screen.queryByTestId('otp-input')).toBeNull();
  });

  it('keeps only digits and at most six of them', async () => {
    installFakeApi();
    await renderApp(<VerifyScreen />);

    await typeOtp('12a3 45-678');
    expect(screen.getByTestId('otp-input').props.value).toBe('123456');
  });

  it('refuses an incomplete code locally, without calling the server', async () => {
    const api = installFakeApi();
    await renderApp(<VerifyScreen />);

    await typeOtp('123');
    await pressVerify();

    expect(screen.getByTestId('otp-input-error').props.children).toBe(OTP_ERROR);
    expect(api.callsTo('POST /api/auth/verify-otp')).toHaveLength(0);
  });

  it('signs in with a correct code: sends phone + code, saves the token, stores the user', async () => {
    const api = installFakeApi({ 'POST /api/auth/verify-otp': () => ok(LOGIN_RESULT) });
    await renderApp(<VerifyScreen />, { probe: true });
    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedOut'));

    await typeOtp('123456');
    await pressVerify();

    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedIn'));
    expect(api.callsTo('POST /api/auth/verify-otp')[0]?.body).toEqual({ phone: PHONE, otp: '123456' });
    expect(secureStore().get('miniledger.access_token')).toBe(LOGIN_RESULT.token);
    expect(screen.getByTestId('auth-user').props.children).toBe(USER.phone);
  });

  it('ignores extra taps while verification is in flight (one request only)', async () => {
    const gate = deferred();
    const api = installFakeApi({
      'POST /api/auth/verify-otp': () => ({ ...ok(LOGIN_RESULT), delayUntil: gate.promise }),
    });
    await renderApp(<VerifyScreen />);

    await typeOtp('123456');
    await pressVerify();
    await pressVerify();

    expect(api.callsTo('POST /api/auth/verify-otp')).toHaveLength(1);
    gate.release();
    await waitFor(() => expect(secureStore().get('miniledger.access_token')).toBe(LOGIN_RESULT.token));
  });

  it('tells the user how many attempts are left after a wrong code, and clears the field', async () => {
    installFakeApi({
      'POST /api/auth/verify-otp': () => fail(401, 'INVALID_OTP', 'Incorrect code.', { attemptsRemaining: 4 }),
    });
    await renderApp(<VerifyScreen />, { probe: true });

    await typeOtp('000000');
    await pressVerify();

    expect(await screen.findByTestId('verify-error')).toHaveTextContent('Incorrect code. 4 attempts left.');
    expect(screen.getByTestId('otp-input').props.value).toBe('');
    // A wrong code is not an expired session: nothing is signed out.
    expect(screen.getByTestId('auth-status').props.children).not.toBe('signedIn');
    expect(screen.getByTestId('auth-notice').props.children).toBe('');
  });

  it('uses the singular for the last attempt', async () => {
    installFakeApi({
      'POST /api/auth/verify-otp': () => fail(401, 'INVALID_OTP', 'Incorrect code.', { attemptsRemaining: 1 }),
    });
    await renderApp(<VerifyScreen />);

    await typeOtp('000000');
    await pressVerify();

    expect(await screen.findByTestId('verify-error')).toHaveTextContent('Incorrect code. 1 attempt left.');
  });

  it('shows the plain server message once the code is locked or expired (no attempts line)', async () => {
    const api = installFakeApi({
      'POST /api/auth/verify-otp': () => fail(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many wrong codes. Request a new code.'),
    });
    await renderApp(<VerifyScreen />);

    await typeOtp('000000');
    await pressVerify();
    expect(await screen.findByTestId('verify-error')).toHaveTextContent('Too many wrong codes. Request a new code.');

    api.on('POST /api/auth/verify-otp', () => fail(401, 'OTP_EXPIRED', 'This code has expired. Request a new one.'));
    await typeOtp('111111');
    await pressVerify();
    await waitFor(() =>
      expect(screen.getByTestId('verify-error')).toHaveTextContent('This code has expired. Request a new one.'),
    );
  });

  it('keeps the typed code when the failure was only the network, so the user can retry', async () => {
    installFakeApi({
      'POST /api/auth/verify-otp': () => {
        throw new TypeError('Network request failed');
      },
    });
    await renderApp(<VerifyScreen />);

    await typeOtp('123456');
    await pressVerify();

    expect(await screen.findByTestId('verify-error')).toBeTruthy();
    expect(screen.getByTestId('otp-input').props.value).toBe('123456');
    expect(screen.getByTestId('verify-button').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('goes back to the login screen from "Change number"', async () => {
    installFakeApi();
    await renderApp(<VerifyScreen />);

    await fireEvent.press(screen.getByTestId('change-number-button'));
    expect(getRouter().back).toHaveBeenCalledTimes(1);
  });
});

describe('VerifyScreen resend cooldown', () => {
  it('disables resend and counts down from the value the login screen passed', async () => {
    jest.useFakeTimers();
    setParams({ phone: PHONE, resendAfter: '3' });
    const api = installFakeApi({ 'POST /api/auth/request-otp': () => ok({ expiresInSeconds: 300, resendAfterSeconds: 60 }) });
    await renderApp(<VerifyScreen />);

    expect(resendLabel()).toBe('Resend code in 3s');
    expect(screen.getByTestId('resend-button').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('resend-button'));
    expect(api.calls).toHaveLength(0); // still cooling down

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(resendLabel()).toBe('Resend code in 2s');

    // Each tick is scheduled by an effect after the previous re-render, so advance one second at a time.
    for (let tick = 0; tick < 2; tick += 1) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(1000);
      });
    }
    expect(resendLabel()).toBe('Resend code');
    expect(screen.getByTestId('resend-button').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('falls back to 60 seconds when the cooldown param is missing or nonsense', async () => {
    setParams({ phone: PHONE, resendAfter: 'abc' });
    installFakeApi();
    await renderApp(<VerifyScreen />);
    expect(resendLabel()).toBe('Resend code in 60s');
  });

  it('requests a new code once the cooldown ends, clears the field, restarts the cooldown and says earlier codes are void', async () => {
    jest.useFakeTimers();
    setParams({ phone: PHONE, resendAfter: '1' });
    const api = installFakeApi({ 'POST /api/auth/request-otp': () => ok({ expiresInSeconds: 300, resendAfterSeconds: 45 }) });
    await renderApp(<VerifyScreen />);

    await typeOtp('12');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    await fireEvent.press(screen.getByTestId('resend-button'));

    await waitFor(() => expect(screen.getByTestId('verify-info')).toBeTruthy());
    expect(screen.getByTestId('verify-info')).toHaveTextContent('A new code was sent. Earlier codes no longer work.');
    expect(api.callsTo('POST /api/auth/request-otp')[0]?.body).toEqual({ phone: PHONE });
    expect(screen.getByTestId('otp-input').props.value).toBe('');
    expect(resendLabel()).toBe('Resend code in 45s');
  });

  it('adopts the server wait time if the server says "too soon"', async () => {
    jest.useFakeTimers();
    setParams({ phone: PHONE, resendAfter: '1' });
    installFakeApi({
      'POST /api/auth/request-otp': () =>
        fail(429, 'OTP_RESEND_TOO_SOON', 'Wait before requesting another code.', { retryAfterSeconds: 20 }),
    });
    await renderApp(<VerifyScreen />);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    await fireEvent.press(screen.getByTestId('resend-button'));

    await waitFor(() => expect(screen.getByTestId('verify-error')).toBeTruthy());
    expect(resendLabel()).toBe('Resend code in 20s');
  });
});
