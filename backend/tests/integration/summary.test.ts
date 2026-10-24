import request from 'supertest';
import {
  PHONE_A,
  PHONE_B,
  closeTestContext,
  createLoan,
  createTestContext,
  loginAs,
  resetDatabase,
  type LoggedInUser,
  type TestContext,
} from '../setup/test-app';

let ctx: TestContext;
let alice: LoggedInUser;

// "Now" is 15:30 on 21 Oct 2026 in IST, so the application's today is 2026-10-21.
const NOW = new Date('2026-10-21T10:00:00.000Z');
const YESTERDAY = '2026-10-20';
const TODAY = '2026-10-21';
const TOMORROW = '2026-10-22';

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => closeTestContext(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.sender.sent.length = 0;
  ctx.clock.set(NOW);
  alice = await loginAs(ctx, PHONE_A);
});

const summary = async (user: LoggedInUser = alice) =>
  (await request(ctx.app).get('/api/summary').set(user.auth).expect(200)).body.data as {
    totalLent: string;
    totalRepaid: string;
    overdueAmount: string;
    currency: string;
    asOf: string;
    timezone: string;
  };

const totals = async (user?: LoggedInUser) => {
  const { totalLent, totalRepaid, overdueAmount } = await summary(user);
  return { totalLent, totalRepaid, overdueAmount };
};

const repay = (id: string, user: LoggedInUser = alice) =>
  request(ctx.app).patch(`/api/loans/${id}/repay`).set(user.auth).expect(200);

describe('GET /api/summary', () => {
  it('requires authentication', async () => {
    await request(ctx.app).get('/api/summary').expect(401);
  });

  it('documents its schema: decimal strings, currency, asOf date and timezone', async () => {
    const s = await summary();
    expect(s).toEqual({
      totalLent: '0.00',
      totalRepaid: '0.00',
      overdueAmount: '0.00',
      currency: 'INR',
      asOf: '2026-10-21',
      timezone: 'Asia/Kolkata',
    });
  });

  it('no loans: all zero', async () => {
    expect(await totals()).toEqual({ totalLent: '0.00', totalRepaid: '0.00', overdueAmount: '0.00' });
  });

  it('one unpaid (future) loan', async () => {
    await createLoan(ctx, alice, { amount: '1000', dueDate: TOMORROW });
    expect(await totals()).toEqual({ totalLent: '1000.00', totalRepaid: '0.00', overdueAmount: '0.00' });
  });

  it('multiple unpaid loans are summed exactly', async () => {
    await createLoan(ctx, alice, { amount: '10.10', dueDate: TOMORROW });
    await createLoan(ctx, alice, { amount: '20.20', dueDate: '2026-12-01' });
    await createLoan(ctx, alice, { amount: '0.01', dueDate: '2027-01-01' });
    expect(await totals()).toEqual({ totalLent: '30.31', totalRepaid: '0.00', overdueAmount: '0.00' });
  });

  it('a repaid loan counts as lent and repaid, and is no longer outstanding', async () => {
    const loan = await createLoan(ctx, alice, { amount: '500', dueDate: TOMORROW });
    await repay(loan.id);
    expect(await totals()).toEqual({ totalLent: '500.00', totalRepaid: '500.00', overdueAmount: '0.00' });
  });

  it('an overdue unpaid loan is counted as overdue', async () => {
    await createLoan(ctx, alice, { amount: '300', dueDate: YESTERDAY });
    expect(await totals()).toEqual({ totalLent: '300.00', totalRepaid: '0.00', overdueAmount: '300.00' });
  });

  it('a loan due today is NOT overdue', async () => {
    await createLoan(ctx, alice, { amount: '300', dueDate: TODAY });
    expect(await totals()).toEqual({ totalLent: '300.00', totalRepaid: '0.00', overdueAmount: '0.00' });
  });

  it('a future loan is NOT overdue', async () => {
    await createLoan(ctx, alice, { amount: '300', dueDate: TOMORROW });
    expect((await totals()).overdueAmount).toBe('0.00');
  });

  it('a repaid loan whose due date has passed is NEVER overdue', async () => {
    const loan = await createLoan(ctx, alice, { amount: '800', dueDate: '2026-01-15' });
    expect((await totals()).overdueAmount).toBe('800.00'); // overdue until it is repaid
    await repay(loan.id);
    expect(await totals()).toEqual({ totalLent: '800.00', totalRepaid: '800.00', overdueAmount: '0.00' });
  });

  it('mixed repaid, outstanding and overdue loans', async () => {
    const paidOnTime = await createLoan(ctx, alice, { amount: '100.50', dueDate: TOMORROW });
    const paidLate = await createLoan(ctx, alice, { amount: '200.25', dueDate: YESTERDAY });
    await createLoan(ctx, alice, { amount: '300.00', dueDate: YESTERDAY }); // overdue
    await createLoan(ctx, alice, { amount: '400.75', dueDate: '2026-06-01' }); // overdue
    await createLoan(ctx, alice, { amount: '500.00', dueDate: TODAY }); // outstanding
    await createLoan(ctx, alice, { amount: '600.00', dueDate: '2027-03-01' }); // outstanding
    await repay(paidOnTime.id);
    await repay(paidLate.id);

    expect(await totals()).toEqual({
      totalLent: '2101.50', // 100.50 + 200.25 + 300 + 400.75 + 500 + 600
      totalRepaid: '300.75', // 100.50 + 200.25
      overdueAmount: '700.75', // 300 + 400.75
    });
  });

  it('updates correctly after adding and after repaying a loan', async () => {
    expect(await totals()).toEqual({ totalLent: '0.00', totalRepaid: '0.00', overdueAmount: '0.00' });

    const a = await createLoan(ctx, alice, { amount: '1000', dueDate: YESTERDAY });
    expect(await totals()).toEqual({ totalLent: '1000.00', totalRepaid: '0.00', overdueAmount: '1000.00' });

    await createLoan(ctx, alice, { amount: '250', dueDate: '2026-12-31' });
    expect(await totals()).toEqual({ totalLent: '1250.00', totalRepaid: '0.00', overdueAmount: '1000.00' });

    await repay(a.id);
    expect(await totals()).toEqual({ totalLent: '1250.00', totalRepaid: '1000.00', overdueAmount: '0.00' });
  });

  it('the three figures agree with the loan list the app shows', async () => {
    await createLoan(ctx, alice, { amount: '120.00', dueDate: YESTERDAY });
    await createLoan(ctx, alice, { amount: '80.00', dueDate: TOMORROW });
    const paid = await createLoan(ctx, alice, { amount: '45.00', dueDate: '2026-02-01' });
    await repay(paid.id);

    const list = (await request(ctx.app).get('/api/loans').set(alice.auth).expect(200)).body.data.loans as Array<{
      amount: string;
      status: string;
    }>;
    const cents = (s: string) => Math.round(Number(s) * 100);
    const sum = (rows: typeof list) => rows.reduce((acc, l) => acc + cents(l.amount), 0);

    const s = await summary();
    expect(cents(s.totalLent)).toBe(sum(list));
    expect(cents(s.totalRepaid)).toBe(sum(list.filter((l) => l.status === 'repaid')));
    expect(cents(s.overdueAmount)).toBe(sum(list.filter((l) => l.status === 'overdue')));
  });

  describe('user isolation', () => {
    it('only ever counts the authenticated user’s loans', async () => {
      const bob = await loginAs(ctx, PHONE_B);

      await createLoan(ctx, alice, { amount: '100', dueDate: YESTERDAY });
      const bobsPaid = await createLoan(ctx, bob, { amount: '9000', dueDate: YESTERDAY });
      await createLoan(ctx, bob, { amount: '1000', dueDate: TOMORROW });
      await repay(bobsPaid.id, bob);

      expect(await totals(alice)).toEqual({ totalLent: '100.00', totalRepaid: '0.00', overdueAmount: '100.00' });
      expect(await totals(bob)).toEqual({ totalLent: '10000.00', totalRepaid: '9000.00', overdueAmount: '0.00' });
    });

    it('a user with no loans sees zeros while others have data', async () => {
      const bob = await loginAs(ctx, PHONE_B);
      await createLoan(ctx, alice, { amount: '999', dueDate: YESTERDAY });
      expect(await totals(bob)).toEqual({ totalLent: '0.00', totalRepaid: '0.00', overdueAmount: '0.00' });
    });
  });

  describe('decimal safety', () => {
    it('adds 0.10 + 0.20 to exactly 0.30 (the classic float failure)', async () => {
      await createLoan(ctx, alice, { amount: '0.10', dueDate: TOMORROW });
      await createLoan(ctx, alice, { amount: '0.20', dueDate: TOMORROW });
      expect((await summary()).totalLent).toBe('0.30');
    });

    it('sums many fractional amounts without drift', async () => {
      for (let i = 0; i < 30; i++) await createLoan(ctx, alice, { amount: '0.10', dueDate: TOMORROW });
      expect((await summary()).totalLent).toBe('3.00');
    });

    it('handles totals far beyond a single loan’s maximum', async () => {
      for (let i = 0; i < 3; i++) await createLoan(ctx, alice, { amount: '9999999999.99', dueDate: TOMORROW });
      expect((await summary()).totalLent).toBe('29999999999.97');
    });
  });

  describe('overdue at the date boundary (IST midnight)', () => {
    // These tests jump the injected clock more than 7 days past the login in beforeEach, so the
    // original session has (correctly) expired. Each one logs in again at the instant it jumps to.
    it('is not overdue at 23:59:59 IST on the due date, and overdue at 00:00:00 IST the next day', async () => {
      await createLoan(ctx, alice, { amount: '250', dueDate: '2026-10-31' });

      const user = await loginAs(ctx, PHONE_A, new Date('2026-10-31T18:29:59.000Z')); // 23:59:59 IST, 31 Oct
      let s = await summary(user);
      expect(s.asOf).toBe('2026-10-31');
      expect(s.overdueAmount).toBe('0.00');

      ctx.clock.set(new Date('2026-10-31T18:30:00.000Z')); // 00:00:00 IST, 1 Nov
      s = await summary(user);
      expect(s.asOf).toBe('2026-11-01');
      expect(s.overdueAmount).toBe('250.00');
    });

    it('uses the IST date, not the UTC date, between 00:00 and 05:30 IST', async () => {
      await createLoan(ctx, alice, { amount: '250', dueDate: '2026-10-31' });
      // 01:30 on 1 Nov in IST is still 31 Oct in UTC.
      const user = await loginAs(ctx, PHONE_A, new Date('2026-10-31T20:00:00.000Z'));
      const s = await summary(user);
      expect(s.asOf).toBe('2026-11-01');
      expect(s.overdueAmount).toBe('250.00');
    });

    it('the loan list and the summary flip at the very same instant', async () => {
      await createLoan(ctx, alice, { amount: '250', dueDate: '2026-10-31' });
      const user = await loginAs(ctx, PHONE_A, new Date('2026-10-31T18:29:59.000Z'));
      for (const [instant, overdue] of [
        ['2026-10-31T18:29:59.000Z', false],
        ['2026-10-31T18:30:00.000Z', true],
      ] as const) {
        ctx.clock.set(new Date(instant));
        const list = (await request(ctx.app).get('/api/loans').set(user.auth).expect(200)).body.data.loans;
        expect(list[0].status === 'overdue').toBe(overdue);
        expect((await summary(user)).overdueAmount === '250.00').toBe(overdue);
      }
    });

    it('a repaid loan stays out of overdue across the boundary', async () => {
      const loan = await createLoan(ctx, alice, { amount: '250', dueDate: '2026-10-31' });
      await repay(loan.id);
      const user = await loginAs(ctx, PHONE_A, new Date('2026-12-31T00:00:00.000Z'));
      expect((await summary(user)).overdueAmount).toBe('0.00');
    });
  });
});

describe('APP_TIMEZONE is configurable', () => {
  it('uses America/New_York for "today" when configured', async () => {
    const ny = await createTestContext({ config: { appTimezone: 'America/New_York' }, start: NOW });
    try {
      const user = await loginAs(ny, PHONE_A);
      await createLoan(ny, user, { amount: '75', dueDate: '2026-10-14' });

      ny.clock.set(new Date('2026-10-15T03:59:59.000Z')); // 23:59:59 on 14 Oct in New York
      let res = await request(ny.app).get('/api/summary').set(user.auth).expect(200);
      expect(res.body.data).toMatchObject({ asOf: '2026-10-14', timezone: 'America/New_York', overdueAmount: '0.00' });

      ny.clock.set(new Date('2026-10-15T04:00:00.000Z')); // 00:00:00 on 15 Oct in New York
      res = await request(ny.app).get('/api/summary').set(user.auth).expect(200);
      expect(res.body.data).toMatchObject({ asOf: '2026-10-15', overdueAmount: '75.00' });
    } finally {
      await closeTestContext(ny);
    }
  });
});
