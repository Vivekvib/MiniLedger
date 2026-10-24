import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import AddLoanScreen from '../../src/app/(app)/add-loan';
import { useFlash } from '../../src/context/FlashContext';
import { deferred, fail, installFakeApi, makeLoan, ok } from '../helpers/fakeApi';
import { renderApp, resetSession, signedInSession } from '../helpers/render';
import { getRouter } from '../helpers/router';

/** Shows the flash message the screen leaves for the dashboard. */
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

const open = DateTimePickerAndroid.open as jest.Mock;

async function fill(name: string, amount: string) {
  await fireEvent.changeText(screen.getByTestId('friend-name-input'), name);
  await fireEvent.changeText(screen.getByTestId('amount-input'), amount);
}

const save = () => fireEvent.press(screen.getByTestId('save-loan-button'));

/** Picks a date the way the Android dialog reports it. */
async function pickDate(date: Date) {
  await fireEvent.press(screen.getByTestId('due-date-field'));
  const options = open.mock.calls.at(-1)![0] as { onValueChange: (event: unknown, date: Date) => void };
  await act(async () => {
    options.onValueChange({}, date);
  });
}

const dueDateText = () => screen.getByTestId('due-date-field-value').props.children as string;

beforeEach(() => {
  signedInSession();
  // Freeze only the clock (not the timers), so "7 days from today" is deterministic.
  jest.useFakeTimers({
    now: new Date(2026, 9, 22, 14, 30),
    doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
});

afterEach(() => {
  resetSession();
  jest.useRealTimers();
});

describe('AddLoanScreen: the form', () => {
  it('starts empty with the due date a week from today', async () => {
    installFakeApi();
    await renderScreen();

    expect(screen.getByTestId('friend-name-input').props.value).toBe('');
    expect(screen.getByTestId('amount-input').props.value).toBe('');
    expect(dueDateText()).toBe('29 Oct 2026');
    expect(screen.getByText('₹')).toBeTruthy();
  });

  it('keeps only a valid decimal amount while typing', async () => {
    installFakeApi();
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('amount-input'), '1,500.567abc');
    expect(screen.getByTestId('amount-input').props.value).toBe('1500.56');
  });

  it('opens the native Android date dialog on the current value, limited to the server range', async () => {
    installFakeApi();
    await renderScreen();

    await fireEvent.press(screen.getByTestId('due-date-field'));

    expect(open).toHaveBeenCalledTimes(1);
    const options = open.mock.calls[0]![0];
    expect(options.mode).toBe('date');
    expect(options.value).toEqual(new Date(2026, 9, 29));
    expect(options.minimumDate).toEqual(new Date(2000, 0, 1));
    expect(options.maximumDate).toEqual(new Date(2100, 11, 31));
  });

  it('shows the picked date', async () => {
    installFakeApi();
    await renderScreen();

    await pickDate(new Date(2026, 11, 25));
    expect(dueDateText()).toBe('25 Dec 2026');
  });

  it('goes back from Cancel without sending anything', async () => {
    const api = installFakeApi();
    await renderScreen();

    await fireEvent.press(screen.getByTestId('cancel-button'));
    expect(getRouter().back).toHaveBeenCalledTimes(1);
    expect(api.calls).toHaveLength(0);
  });
});

describe('AddLoanScreen: validation', () => {
  it('reports every problem next to its field and sends nothing', async () => {
    const api = installFakeApi();
    await renderScreen();

    await save();

    expect(screen.getByTestId('friend-name-input-error').props.children).toBe("Enter your friend's name.");
    expect(screen.getByTestId('amount-input-error').props.children).toMatch(/enter the amount/i);
    expect(api.calls).toHaveLength(0);
    expect(getRouter().back).not.toHaveBeenCalled();
  });

  it('rejects zero, and clears each message as soon as the user edits that field', async () => {
    installFakeApi();
    await renderScreen();

    await fill('Asha', '0');
    await save();
    expect(screen.getByTestId('amount-input-error').props.children).toBe('Amount must be greater than 0.');

    await fireEvent.changeText(screen.getByTestId('amount-input'), '5');
    expect(screen.queryByTestId('amount-input-error')).toBeNull();
  });

  it('rejects a due date outside 2000-2100', async () => {
    const api = installFakeApi();
    await renderScreen();

    await fill('Asha', '100');
    await pickDate(new Date(1999, 5, 1));
    await save();

    expect(screen.getByTestId('due-date-field-error').props.children).toMatch(/between the years 2000 and 2100/);
    expect(api.calls).toHaveLength(0);
  });

  it('allows a past due date (a loan that is already overdue)', async () => {
    const api = installFakeApi({ 'POST /api/loans': () => ok(makeLoan(), 201) });
    await renderScreen();

    await fill('Asha', '100');
    await pickDate(new Date(2026, 0, 5));
    await save();

    await waitFor(() => expect(api.callsTo('POST /api/loans')).toHaveLength(1));
    expect(api.callsTo('POST /api/loans')[0]?.body).toMatchObject({ dueDate: '2026-01-05' });
  });
});

describe('AddLoanScreen: saving', () => {
  it('sends the exact payload with an Idempotency-Key, then goes back and leaves a confirmation', async () => {
    const api = installFakeApi({ 'POST /api/loans': () => ok(makeLoan({ friendName: 'Asha' }), 201) });
    const { queryClient } = await renderScreen();
    queryClient.setQueryData(['loans'], []);
    queryClient.setQueryData(['summary'], {});

    await fill('  Asha  ', '1500.5');
    await pickDate(new Date(2026, 10, 1));
    await save();

    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
    const [call] = api.callsTo('POST /api/loans');
    expect(call?.body).toEqual({ friendName: 'Asha', amount: '1500.5', dueDate: '2026-11-01' });
    expect(call?.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(call?.headers.Authorization).toMatch(/^Bearer /);
    expect(screen.getByTestId('flash-probe').props.children).toBe('success:Loan added: Asha.');

    // The dashboard's list and summary are marked stale, so it refetches both when it is shown.
    expect(queryClient.getQueryState(['loans'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['summary'])?.isInvalidated).toBe(true);
  });

  it('ignores extra taps while the request is in flight (one POST only)', async () => {
    const gate = deferred();
    const api = installFakeApi({ 'POST /api/loans': () => ({ ...ok(makeLoan(), 201), delayUntil: gate.promise }) });
    await renderScreen();

    await fill('Asha', '100');
    await save();
    await save();
    await save();

    await waitFor(() => expect(screen.getByTestId('save-loan-button').props.accessibilityState).toMatchObject({ busy: true }));
    expect(api.callsTo('POST /api/loans')).toHaveLength(1);
    expect(screen.getByTestId('cancel-button').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByTestId('friend-name-input').props.editable).toBe(false);

    gate.release();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));
  });

  it('re-sends the SAME Idempotency-Key when the user retries an unchanged form after a failure', async () => {
    let online = false;
    const api = installFakeApi({
      'POST /api/loans': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok(makeLoan(), 201);
      },
    });
    await renderScreen();

    await fill('Asha', '100');
    await save();
    expect(await screen.findByTestId('form-error')).toBeTruthy();
    expect(getRouter().back).not.toHaveBeenCalled();
    expect(screen.getByTestId('friend-name-input').props.value).toBe('Asha'); // nothing the user typed is lost

    online = true;
    await save();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));

    const keys = api.callsTo('POST /api/loans').map((c) => c.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('uses a NEW key once the details have been edited, and a new key for the next loan', async () => {
    let online = false;
    const api = installFakeApi({
      'POST /api/loans': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok(makeLoan(), 201);
      },
    });
    await renderScreen();

    await fill('Asha', '100');
    await save();
    await screen.findByTestId('form-error');

    await fireEvent.changeText(screen.getByTestId('amount-input'), '250');
    online = true;
    await save();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));

    const calls = api.callsTo('POST /api/loans');
    expect(calls[1]?.body).toMatchObject({ amount: '250' });
    expect(calls[1]?.headers['Idempotency-Key']).not.toBe(calls[0]?.headers['Idempotency-Key']);
  });

  it('shows a clear message when the server cannot be reached, and lets the user try again', async () => {
    installFakeApi({
      'POST /api/loans': () => {
        throw new TypeError('Network request failed');
      },
    });
    await renderScreen();

    await fill('Asha', '100');
    await save();

    const banner = await screen.findByTestId('form-error');
    expect(banner).toHaveTextContent(/reach the server|connection/i);
    expect(screen.getByTestId('save-loan-button').props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.getByTestId('flash-probe').props.children).toBe('');
  });

  it('maps server field errors (400) onto the matching fields', async () => {
    installFakeApi({
      'POST /api/loans': () =>
        fail(400, 'VALIDATION_ERROR', 'Invalid request.', {
          fields: { amount: 'Amount must have at most 2 decimal places.', friendName: 'Friend name is too long.' },
        }),
    });
    await renderScreen();

    await fill('Asha', '100');
    await save();

    expect(await screen.findByTestId('amount-input-error')).toHaveTextContent('Amount must have at most 2 decimal places.');
    expect(screen.getByTestId('friend-name-input-error')).toHaveTextContent('Friend name is too long.');
    expect(screen.queryByTestId('form-error')).toBeNull();
    expect(getRouter().back).not.toHaveBeenCalled();
  });

  it('shows the general message when a 400 names no field we have', async () => {
    installFakeApi({ 'POST /api/loans': () => fail(400, 'VALIDATION_ERROR', 'Invalid request.', { fields: { other: 'nope' } }) });
    await renderScreen();

    await fill('Asha', '100');
    await save();

    expect(await screen.findByTestId('form-error')).toHaveTextContent('Invalid request.');
  });

  it('recovers from a reused-key conflict (422) by starting a fresh attempt', async () => {
    let conflict = true;
    const api = installFakeApi({
      'POST /api/loans': () =>
        conflict ? fail(422, 'IDEMPOTENCY_KEY_REUSED', 'Key was used for a different request.') : ok(makeLoan(), 201),
    });
    await renderScreen();

    await fill('Asha', '100');
    await save();
    expect(await screen.findByTestId('form-error')).toHaveTextContent(/Press Save loan again/);

    conflict = false;
    await save();
    await waitFor(() => expect(getRouter().back).toHaveBeenCalledTimes(1));

    const keys = api.callsTo('POST /api/loans').map((c) => c.headers['Idempotency-Key']);
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('does not navigate or flash after the screen is gone (leaving mid-request is safe)', async () => {
    const gate = deferred();
    installFakeApi({ 'POST /api/loans': () => ({ ...ok(makeLoan(), 201), delayUntil: gate.promise }) });
    const { unmount } = await renderScreen();

    await fill('Asha', '100');
    await save();
    await unmount();

    await act(async () => {
      gate.release();
    });
    expect(getRouter().back).not.toHaveBeenCalled();
  });
});
