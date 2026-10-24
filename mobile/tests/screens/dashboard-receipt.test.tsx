import { fireEvent, screen } from '@testing-library/react-native';
import DashboardScreen from '../../src/app/(app)/index';
import { installFakeApi, makeLoan, makeReceipt, makeSummary, ok } from '../helpers/fakeApi';
import { renderApp, resetSession, signedInSession } from '../helpers/render';
import { getRouter } from '../helpers/router';

const A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const C = '33333333-3333-4333-8333-cccccccccccc';

const withoutReceipt = makeLoan({ id: A, friendName: 'Asha', amount: '1500.00' });
const withReceipt = makeLoan({ id: B, friendName: 'Ravi', amount: '250.50', receipt: makeReceipt() });
const repaidWithReceipt = makeLoan({
  id: C,
  friendName: 'Meera',
  amount: '99.00',
  status: 'repaid',
  repaidAt: '2026-09-02T08:00:00.000Z',
  receipt: makeReceipt(),
});
const repaidWithout = makeLoan({
  id: '44444444-4444-4444-8444-dddddddddddd',
  friendName: 'Kabir',
  amount: '10.00',
  status: 'repaid',
  repaidAt: '2026-09-02T08:00:00.000Z',
});

beforeEach(() => {
  signedInSession();
  installFakeApi({
    'GET /api/loans': () => ok({ loans: [withoutReceipt, withReceipt, repaidWithReceipt, repaidWithout] }),
    'GET /api/summary': () => ok(makeSummary()),
  });
});
afterEach(resetSession);

describe('DashboardScreen: receipts on the loan rows', () => {
  it('says "Add receipt" for a loan without one and "View receipt" for one with a receipt', async () => {
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    expect(screen.getByTestId(`receipt-${A}`)).toHaveTextContent('Add receipt');
    expect(screen.getByTestId(`receipt-${B}`)).toHaveTextContent('View receipt');
    expect(screen.getByTestId(`receipt-${C}`)).toHaveTextContent('View receipt');
  });

  it('offers the receipt action on repaid loans too, with or without a receipt', async () => {
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${C}`);

    expect(screen.getByTestId('receipt-44444444-4444-4444-8444-dddddddddddd')).toHaveTextContent('Add receipt');
    expect(screen.getByTestId(`receipt-${C}`)).toHaveTextContent('View receipt');
    // Mark repaid is still only for loans that are not repaid.
    expect(screen.queryByTestId(`repay-${C}`)).toBeNull();
    expect(screen.getByTestId(`repay-${A}`)).toBeTruthy();
  });

  it('opens that loan\'s receipt screen when pressed', async () => {
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    await fireEvent.press(screen.getByTestId(`receipt-${B}`));
    expect(getRouter().push).toHaveBeenCalledWith(`/receipt/${B}`);

    await fireEvent.press(screen.getByTestId(`receipt-${A}`));
    expect(getRouter().push).toHaveBeenLastCalledWith(`/receipt/${A}`);
  });

  it('describes the action for screen readers with the friend\'s name', async () => {
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    expect(screen.getByLabelText('Add a receipt to the loan to Asha')).toBeTruthy();
    expect(screen.getByLabelText('View the receipt for the loan to Ravi')).toBeTruthy();
  });

  it('adds "receipt attached" to the row\'s spoken summary only when there is a receipt', async () => {
    await renderApp(<DashboardScreen />);
    await screen.findByTestId(`loan-${A}`);

    expect(screen.getByLabelText(/^Ravi, .*receipt attached$/)).toBeTruthy();
    expect(screen.getByLabelText(/^Asha, .*outstanding$/)).toBeTruthy();
  });
});
