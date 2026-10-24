import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import DashboardScreen from '../../src/app/(app)/index';
import type { Loan, Summary } from '../../src/types/api';
import { deferred, fail, installFakeApi, makeLoan, makeSummary, ok, USER, type FakeApi } from '../helpers/fakeApi';
import { newTestQueryClient, renderApp, resetSession, signedInSession } from '../helpers/render';
import { getRouter } from '../helpers/router';

const A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const C = '33333333-3333-4333-8333-cccccccccccc';

const outstanding = makeLoan({ id: A, friendName: 'Asha', amount: '1500.00', dueDate: '2026-12-01' });
const overdue = makeLoan({ id: B, friendName: 'Ravi', amount: '250.50', dueDate: '2026-10-10', status: 'overdue', daysOverdue: 11 });
const repaid = makeLoan({
  id: C,
  friendName: 'Meera',
  amount: '99999.99',
  dueDate: '2026-09-01',
  status: 'repaid',
  repaidAt: '2026-09-02T08:00:00.000Z',
});

/**
 * A tiny in-memory backend behind the fetch boundary: it owns the loans, derives the summary from
 * them and applies repayments, so the dashboard is tested against changing server state.
 */
function installServer(initial: Loan[]) {
  const state = { loans: [...initial] };
  const sum = (predicate: (loan: Loan) => boolean) =>
    state.loans.filter(predicate).reduce((total, loan) => total + Math.round(Number(loan.amount) * 100), 0) / 100;
  const money = (n: number) => n.toFixed(2);
  const summary = (): Summary =>
    makeSummary({
      totalLent: money(sum(() => true)),
      totalRepaid: money(sum((l) => l.status === 'repaid')),
      overdueAmount: money(sum((l) => l.status === 'overdue')),
    });

  const api = installFakeApi({
    'GET /api/loans': () => ok({ loans: state.loans }),
    'GET /api/summary': () => ok(summary()),
    ...Object.fromEntries(
      initial.map((loan) => [
        `PATCH /api/loans/${loan.id}/repay`,
        () => {
          const current = state.loans.find((l) => l.id === loan.id)!;
          if (current.status === 'repaid') return fail(409, 'ALREADY_REPAID', 'This loan is already marked as repaid.');
          const updated: Loan = { ...current, status: 'repaid', repaidAt: '2026-10-22T09:00:00.000Z', daysOverdue: 0 };
          state.loans = state.loans.map((l) => (l.id === loan.id ? updated : l));
          return ok(updated);
        },
      ]),
    ),
  });
  return { api, state };
}

/** Taps a button inside the most recent Alert.alert(...) call, the way the user would. */
function lastAlert(spy: jest.SpyInstance) {
  const [title, message, buttons] = spy.mock.calls.at(-1) as [string, string, AlertButton[]];
  return {
    title,
    message,
    press: async (text: string) => {
      const button = buttons.find((b) => b.text === text);
      if (!button) throw new Error(`No "${text}" button in the alert`);
      // A button without a handler (Cancel) only closes the dialog.
      await act(async () => {
        button.onPress?.();
      });
    },
  };
}

const totals = () => ({
  lent: screen.getByTestId('summary-total-lent-value').props.children as string,
  repaid: screen.getByTestId('summary-total-repaid-value').props.children as string,
  overdue: screen.getByTestId('summary-overdue-value').props.children as string,
});

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  signedInSession();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  resetSession();
  jest.useRealTimers();
});

describe('DashboardScreen: loading the data', () => {
  it('shows a loading state until the first responses arrive', async () => {
    const gate = deferred();
    installFakeApi({
      'GET /api/loans': () => ({ ...ok({ loans: [outstanding] }), delayUntil: gate.promise }),
      'GET /api/summary': () => ok(makeSummary({ totalLent: '1500.00' })),
    });
    await renderApp(<DashboardScreen />);

    expect(screen.getByTestId('loading-state')).toBeTruthy();
    expect(screen.queryByTestId('summary-table')).toBeNull();

    gate.release();
    expect(await screen.findByTestId('summary-table')).toBeTruthy();
    expect(screen.queryByTestId('loading-state')).toBeNull();
  });

  it('shows the server summary with Indian grouping, never recomputed on the phone', async () => {
    // The list deliberately disagrees with the summary: the screen must show the summary as sent.
    installFakeApi({
      'GET /api/loans': () => ok({ loans: [outstanding] }),
      'GET /api/summary': () =>
        ok(makeSummary({ totalLent: '150000.00', totalRepaid: '1234567.89', overdueAmount: '99999.99' })),
    });
    await renderApp(<DashboardScreen />);
    await screen.findByTestId('summary-table');

    expect(totals()).toEqual({ lent: '₹1,50,000.00', repaid: '₹12,34,567.89', overdue: '₹99,999.99' });
  });

  it('splits the loans into Outstanding and Repaid, spelling out each status in words', async () => {
    installServer([outstanding, overdue, repaid]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    expect(screen.getByRole('header', { name: 'Outstanding' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Repaid' })).toBeTruthy();

    expect(within(screen.getByTestId(`loan-${A}`)).getByText('Asha')).toBeTruthy();
    expect(within(screen.getByTestId(`loan-${A}`)).getByText('₹1,500.00')).toBeTruthy();
    expect(within(screen.getByTestId(`loan-${A}`)).getByText('Due 1 Dec 2026')).toBeTruthy();
    expect(within(screen.getByTestId(`loan-${A}`)).getByText('Outstanding')).toBeTruthy();

    expect(within(screen.getByTestId(`loan-${B}`)).getByText('₹250.50')).toBeTruthy();
    expect(within(screen.getByTestId(`loan-${B}`)).getByText('Overdue · 11 days')).toBeTruthy();

    expect(within(screen.getByTestId(`loan-${C}`)).getByText('₹99,999.99')).toBeTruthy();
    expect(within(screen.getByTestId(`loan-${C}`)).getByText(/^Repaid /)).toBeTruthy();
  });

  it('offers "Mark repaid" only on loans that are not repaid yet', async () => {
    installServer([outstanding, overdue, repaid]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    expect(screen.getByTestId(`repay-${A}`)).toBeTruthy();
    expect(screen.getByTestId(`repay-${B}`)).toBeTruthy();
    expect(screen.queryByTestId(`repay-${C}`)).toBeNull();
  });

  it('shows a helpful empty state, still with the (zero) summary, when there are no loans', async () => {
    installServer([]);
    await renderApp(<DashboardScreen />);

    expect(await screen.findByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No loans yet')).toBeTruthy();
    expect(totals()).toEqual({ lent: '₹0.00', repaid: '₹0.00', overdue: '₹0.00' });
  });

  it('shows an error with a retry when nothing could be loaded, and recovers on retry', async () => {
    let online = false;
    installFakeApi({
      'GET /api/loans': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok({ loans: [outstanding] });
      },
      'GET /api/summary': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok(makeSummary({ totalLent: '1500.00' }));
      },
    });
    await renderApp(<DashboardScreen />);

    expect(await screen.findByTestId('error-state')).toBeTruthy();
    expect(screen.getByText("Couldn't load your loans")).toBeTruthy();
    expect(screen.queryByTestId('summary-table')).toBeNull();

    online = true;
    await fireEvent.press(screen.getByTestId('retry-button'));

    expect(await screen.findByTestId('summary-table')).toBeTruthy();
    expect(screen.getByTestId(`loan-${A}`)).toBeTruthy();
    expect(screen.queryByTestId('error-state')).toBeNull();
  });

  it('keeps showing the last data, with a retry banner, when a refresh fails', async () => {
    let online = true;
    installFakeApi({
      'GET /api/loans': () => {
        if (!online) throw new TypeError('Network request failed');
        return ok({ loans: [outstanding] });
      },
      'GET /api/summary': () => ok(makeSummary({ totalLent: '1500.00' })),
    });
    const { queryClient } = await renderApp(<DashboardScreen />, { queryClient: newTestQueryClient() });
    await screen.findByTestId(`loan-${A}`);
    expect(screen.queryByTestId('refresh-error')).toBeNull();

    online = false;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['loans'] });
    });

    expect(await screen.findByTestId('refresh-error')).toBeTruthy();
    expect(screen.getByTestId(`loan-${A}`)).toBeTruthy(); // stale data stays visible
    expect(screen.queryByTestId('error-state')).toBeNull();

    online = true;
    await fireEvent.press(screen.getByLabelText('Try again'));
    await waitFor(() => expect(screen.queryByTestId('refresh-error')).toBeNull());
  });
});

describe('DashboardScreen: marking a loan repaid', () => {
  it('asks for confirmation first, and does nothing if the user cancels', async () => {
    const { api } = installServer([outstanding]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));

    const alert = lastAlert(alertSpy);
    expect(alert.title).toBe('Mark as repaid?');
    expect(alert.message).toBe("Asha paid back ₹1,500.00. This can't be undone.");
    expect(api.callsTo(`PATCH /api/loans/${A}/repay`)).toHaveLength(0); // nothing is sent before confirming

    await alert.press('Cancel');
    expect(api.callsTo(`PATCH /api/loans/${A}/repay`)).toHaveLength(0);
  });

  it('repays, refetches the list and the summary, and shows a confirmation', async () => {
    const { api } = installServer([outstanding, overdue]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);
    expect(totals()).toEqual({ lent: '₹1,750.50', repaid: '₹0.00', overdue: '₹250.50' });

    await fireEvent.press(screen.getByTestId(`repay-${B}`));
    await lastAlert(alertSpy).press('Mark repaid');

    await waitFor(() => expect(screen.getByTestId('flash-banner')).toBeTruthy());
    expect(screen.getByTestId('flash-banner')).toHaveTextContent('Marked as repaid: Ravi.', { exact: false });

    // One PATCH, with the token, then a refetch of both read endpoints.
    expect(api.callsTo(`PATCH /api/loans/${B}/repay`)).toHaveLength(1);
    expect(api.callsTo(`PATCH /api/loans/${B}/repay`)[0]?.headers.Authorization).toMatch(/^Bearer /);
    expect(api.callsTo('GET /api/loans').length).toBeGreaterThanOrEqual(2);
    expect(api.callsTo('GET /api/summary').length).toBeGreaterThanOrEqual(2);

    // The totals moved: Ravi's 250.50 is repaid and no longer overdue.
    expect(totals()).toEqual({ lent: '₹1,750.50', repaid: '₹250.50', overdue: '₹0.00' });
    expect(screen.queryByTestId(`repay-${B}`)).toBeNull();
    expect(within(screen.getByTestId(`loan-${B}`)).getByText(/^Repaid /)).toBeTruthy();
  });

  it('shows the spinner on the row being repaid and sends only one request even if the alert is confirmed twice', async () => {
    const gate = deferred();
    const { api } = installServer([outstanding]);
    api.on(`PATCH /api/loans/${A}/repay`, () => ({
      ...ok({ ...outstanding, status: 'repaid', repaidAt: '2026-10-22T09:00:00.000Z' }),
      delayUntil: gate.promise,
    }));
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    const alert = lastAlert(alertSpy);
    await alert.press('Mark repaid');
    await alert.press('Mark repaid'); // a second confirmation of the same alert

    expect(api.callsTo(`PATCH /api/loans/${A}/repay`)).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId(`repay-${A}`).props.accessibilityState).toMatchObject({ busy: true }));

    // Tapping the button while the request is in flight does not open another confirmation.
    const alertCallsBefore = alertSpy.mock.calls.length;
    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    expect(alertSpy.mock.calls.length).toBe(alertCallsBefore);

    await act(async () => {
      gate.release();
    });
    await waitFor(() => expect(screen.getByTestId('flash-banner')).toBeTruthy());
  });

  it('disables the other rows\' repay buttons while one repayment is in flight (one at a time)', async () => {
    const gate = deferred();
    const { api } = installServer([outstanding, overdue]);
    api.on(`PATCH /api/loans/${A}/repay`, () => ({
      ...ok({ ...outstanding, status: 'repaid', repaidAt: '2026-10-22T09:00:00.000Z' }),
      delayUntil: gate.promise,
    }));
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    await lastAlert(alertSpy).press('Mark repaid');

    await waitFor(() => expect(screen.getByTestId(`repay-${B}`).props.accessibilityState).toMatchObject({ disabled: true }));
    const alertCallsBefore = alertSpy.mock.calls.length;
    await fireEvent.press(screen.getByTestId(`repay-${B}`));
    expect(alertSpy.mock.calls.length).toBe(alertCallsBefore);

    await act(async () => {
      gate.release();
    });
    await waitFor(() => expect(screen.getByTestId(`repay-${B}`).props.accessibilityState).toMatchObject({ disabled: false }));
  });

  it('handles "already repaid" (409): says so, refetches, and shows the loan as repaid', async () => {
    const { api, state } = installServer([outstanding]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    // Another device repays the loan after this screen loaded.
    state.loans = [{ ...outstanding, status: 'repaid', repaidAt: '2026-10-22T08:00:00.000Z' }];

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    await lastAlert(alertSpy).press('Mark repaid');

    await waitFor(() =>
      expect(screen.getByTestId('flash-banner')).toHaveTextContent('That loan was already marked as repaid.', { exact: false }),
    );
    await waitFor(() => expect(screen.queryByTestId(`repay-${A}`)).toBeNull());
    expect(totals().repaid).toBe('₹1,500.00');
    expect(api.callsTo(`PATCH /api/loans/${A}/repay`)).toHaveLength(1);
  });

  it('reports a failed repayment as an error that stays until dismissed, and leaves the loan outstanding', async () => {
    const { api } = installServer([outstanding]);
    api.on(`PATCH /api/loans/${A}/repay`, () => {
      throw new TypeError('Network request failed');
    });
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    await lastAlert(alertSpy).press('Mark repaid');

    const banner = await screen.findByTestId('flash-banner');
    expect(banner).toHaveTextContent(/internet|connect|server/i);
    expect(screen.getByTestId(`repay-${A}`)).toBeTruthy(); // still outstanding, can be retried
    expect(totals().repaid).toBe('₹0.00');
  });

  it('a 404 (the loan no longer exists) is shown as an error and the repay button stays available', async () => {
    const { api } = installServer([outstanding]);
    api.on(`PATCH /api/loans/${A}/repay`, () => fail(404, 'NOT_FOUND', 'Loan not found.'));
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    await lastAlert(alertSpy).press('Mark repaid');

    expect(await screen.findByTestId('flash-banner')).toHaveTextContent('Loan not found.', { exact: false });
  });
});

describe('DashboardScreen: banners', () => {
  it('a confirmation banner can be dismissed by hand', async () => {
    installServer([outstanding]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`repay-${A}`));
    await lastAlert(alertSpy).press('Mark repaid');
    await screen.findByTestId('flash-banner');

    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(screen.queryByTestId('flash-banner')).toBeNull();
  });
});

describe('DashboardScreen: navigation and sign-out', () => {
  it('opens the add-loan screen from the bottom bar', async () => {
    installServer([]);
    await renderApp(<DashboardScreen />);
    await screen.findByTestId('summary-table');

    await fireEvent.press(screen.getByTestId('add-loan-button'));
    expect(getRouter().push).toHaveBeenCalledWith('/add-loan');
  });

  it('asks before signing out, then revokes the session and clears the screen state', async () => {
    jest.requireMock('expo-secure-store').__store.set('miniledger.access_token', 'jwt-token-for-tests');
    const { api } = installServer([outstanding]);
    api.on('GET /api/auth/me', () => ok({ user: USER }));
    api.on('POST /api/auth/logout', () => ok({ loggedOut: true }));
    await renderApp(<DashboardScreen />, { probe: true });
    await screen.findByTestId(`loan-${A}`);
    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedIn'));

    await fireEvent.press(screen.getByTestId('sign-out-button'));
    const alert = lastAlert(alertSpy);
    expect(alert.title).toBe('Sign out?');
    expect(api.callsTo('POST /api/auth/logout')).toHaveLength(0); // nothing happens until confirmed

    await alert.press('Sign out');

    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedOut'));
    expect(api.callsTo('POST /api/auth/logout')).toHaveLength(1);
    expect(jest.requireMock('expo-secure-store').__store.has('miniledger.access_token')).toBe(false);
  });

  it('is signed out with the expiry notice if the server rejects the token while the dashboard is open', async () => {
    jest.requireMock('expo-secure-store').__store.set('miniledger.access_token', 'jwt-token-for-tests');
    let revoked = false;
    const api: FakeApi = installFakeApi({
      'GET /api/auth/me': () => ok({ user: USER }),
      'GET /api/loans': () => (revoked ? fail(401, 'UNAUTHORIZED', 'Authentication required.') : ok({ loans: [outstanding] })),
      'GET /api/summary': () => ok(makeSummary({ totalLent: '1500.00' })),
    });
    const { queryClient } = await renderApp(<DashboardScreen />, { probe: true });
    await screen.findByTestId(`loan-${A}`);
    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedIn'));

    revoked = true;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['loans'] });
    });

    await waitFor(() => expect(screen.getByTestId('auth-status').props.children).toBe('signedOut'));
    expect(screen.getByTestId('auth-notice').props.children).toMatch(/session expired/i);
    expect(api.callsTo('GET /api/loans').length).toBeGreaterThanOrEqual(2);
  });
});
