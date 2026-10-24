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
let bob: LoggedInUser;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => closeTestContext(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.sender.sent.length = 0;
  ctx.clock.set(new Date('2026-10-21T10:00:00.000Z')); // 21 Oct in IST
  alice = await loginAs(ctx, PHONE_A);
  bob = await loginAs(ctx, PHONE_B);
});

const post = (user: LoggedInUser, body: unknown) => request(ctx.app).post('/api/loans').set(user.auth).send(body as object);
const valid = { friendName: 'Example Friend', amount: '1500.00', dueDate: '2026-11-01' };

async function dbLoans(): Promise<Array<Record<string, unknown>>> {
  return (await ctx.pool.query('SELECT * FROM loans ORDER BY created_at, id')).rows;
}

describe('POST /api/loans', () => {
  it('creates a loan and returns every required field', async () => {
    const res = await post(alice, valid).expect(201);
    expect(res.body.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      userId: alice.userId,
      friendName: 'Example Friend',
      amount: '1500.00',
      dueDate: '2026-11-01',
      createdAt: '2026-10-21T10:00:00.000Z',
      repaidAt: null,
      status: 'outstanding',
      daysOverdue: 0,
      receipt: null,
    });
  });

  it('persists the loan in PostgreSQL, owned by the authenticated user', async () => {
    const res = await post(alice, valid).expect(201);
    const rows = await dbLoans();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: res.body.data.id,
      user_id: alice.userId,
      friend_name: 'Example Friend',
      amount: '1500.00',
      due_date: '2026-11-01',
      repaid_at: null,
    });
  });

  it('accepts the amount as a JSON number, as in the assignment example, and normalises it', async () => {
    const res = await post(alice, { ...valid, amount: 1500 }).expect(201);
    expect(res.body.data.amount).toBe('1500.00');
    const half = await post(alice, { ...valid, amount: 1500.5 }).expect(201);
    expect(half.body.data.amount).toBe('1500.50');
  });

  it('trims the friend name and keeps unicode intact', async () => {
    const res = await post(alice, { ...valid, friendName: '  Zoë Müller  ' }).expect(201);
    expect(res.body.data.friendName).toBe('Zoë Müller');
  });

  it('ignores a client-supplied userId: the owner is always the authenticated user', async () => {
    const res = await post(alice, { ...valid, userId: bob.userId, status: 'repaid', repaidAt: '2026-01-01T00:00:00Z' }).expect(201);
    expect(res.body.data.userId).toBe(alice.userId);
    expect(res.body.data.status).toBe('outstanding');
    expect(res.body.data.repaidAt).toBeNull();
  });

  describe('friend name validation', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['whitespace only', '   '],
      ['too long (81 chars)', 'x'.repeat(81)],
      ['control character', 'Bad\u0000Name'],
      ['newline', 'Line\nBreak'],
      ['not a string', 42],
      ['null', null],
    ])('rejects %s', async (_label, friendName) => {
      const res = await post(alice, { ...valid, friendName }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.friendName).toBeTruthy();
      expect(await dbLoans()).toHaveLength(0);
    });

    it('accepts exactly 80 characters', async () => {
      await post(alice, { ...valid, friendName: 'x'.repeat(80) }).expect(201);
    });
  });

  describe('amount validation', () => {
    it.each([
      ['zero', 0, /greater than 0/],
      ['zero string', '0.00', /greater than 0/],
      ['negative', -50, /greater than 0/],
      ['negative string', '-1', /greater than 0/],
      ['not numeric', 'abc', /valid amount/],
      ['thousands separator', '1,500', /valid amount/],
      ['three decimals', '10.123', /valid amount/],
      ['float noise', 0.1 + 0.2, /valid amount/],
      ['too many digits', '12345678901', /valid amount/],
      ['exponent', '1e3', /valid amount/],
      ['boolean', true, /valid amount/],
      ['object', {}, /valid amount/],
      ['missing', undefined, /required/],
      ['null', null, /required/],
    ])('rejects %s', async (_label, amount, message) => {
      const res = await post(alice, { ...valid, amount }).expect(400);
      expect(res.body.error.details.fields.amount).toMatch(message);
      expect(await dbLoans()).toHaveLength(0);
    });

    it('accepts the smallest and largest representable amounts', async () => {
      await post(alice, { ...valid, amount: '0.01' }).expect(201);
      const max = await post(alice, { ...valid, amount: '9999999999.99' }).expect(201);
      expect(max.body.data.amount).toBe('9999999999.99');
    });
  });

  describe('due date validation', () => {
    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['impossible date', '2026-02-30'],
      ['month 13', '2026-13-01'],
      ['day/month/year', '01/11/2026'],
      ['unpadded', '2026-1-1'],
      ['with time', '2026-11-01T00:00:00Z'],
      ['year before 2000', '1999-12-31'],
      ['year after 2100', '2101-01-01'],
      ['number', 20261101],
      ['word', 'tomorrow'],
    ])('rejects %s', async (_label, dueDate) => {
      const res = await post(alice, { ...valid, dueDate }).expect(400);
      expect(res.body.error.details.fields.dueDate).toBeTruthy();
      expect(await dbLoans()).toHaveLength(0);
    });

    it('accepts a due date in the past (an already-overdue loan can be recorded)', async () => {
      const res = await post(alice, { ...valid, dueDate: '2026-10-01' }).expect(201);
      expect(res.body.data.status).toBe('overdue');
      expect(res.body.data.daysOverdue).toBe(20);
    });

    it('accepts a leap day', async () => {
      await post(alice, { ...valid, dueDate: '2028-02-29' }).expect(201);
    });
  });

  it('reports every invalid field at once', async () => {
    const res = await post(alice, { friendName: '', amount: -1, dueDate: 'x' }).expect(400);
    expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['amount', 'dueDate', 'friendName']);
  });

  it('requires authentication, and checks it before validating the body', async () => {
    await request(ctx.app).post('/api/loans').send({ friendName: '' }).expect(401);
  });

  it('rejects malformed JSON with a clear error', async () => {
    const res = await request(ctx.app)
      .post('/api/loans')
      .set(alice.auth)
      .set('Content-Type', 'application/json')
      .send('{"friendName": ')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('treats a missing body as a validation error, not a crash', async () => {
    const res = await request(ctx.app).post('/api/loans').set(alice.auth).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/loans', () => {
  it('returns an empty list for a user with no loans', async () => {
    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    expect(res.body).toEqual({ data: { loans: [] } });
  });

  it('returns only the authenticated user’s loans', async () => {
    await createLoan(ctx, alice, { friendName: 'A1', amount: 10, dueDate: '2026-11-01' });
    await createLoan(ctx, alice, { friendName: 'A2', amount: 20, dueDate: '2026-11-02' });
    await createLoan(ctx, bob, { friendName: 'B1', amount: 30, dueDate: '2026-11-03' });

    const a = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    const b = await request(ctx.app).get('/api/loans').set(bob.auth).expect(200);

    expect(a.body.data.loans.map((l: { friendName: string }) => l.friendName).sort()).toEqual(['A1', 'A2']);
    expect(b.body.data.loans.map((l: { friendName: string }) => l.friendName)).toEqual(['B1']);
    expect(a.body.data.loans.every((l: { userId: string }) => l.userId === alice.userId)).toBe(true);
  });

  it('orders outstanding loans by due date (overdue first), then repaid loans newest first', async () => {
    await createLoan(ctx, alice, { friendName: 'Later', amount: 1, dueDate: '2026-12-01' });
    await createLoan(ctx, alice, { friendName: 'Overdue', amount: 2, dueDate: '2026-10-01' });
    await createLoan(ctx, alice, { friendName: 'Soon', amount: 3, dueDate: '2026-10-25' });
    const paidEarly = await createLoan(ctx, alice, { friendName: 'PaidEarly', amount: 4, dueDate: '2026-09-01' });
    const paidLate = await createLoan(ctx, alice, { friendName: 'PaidLate', amount: 5, dueDate: '2026-09-02' });

    await request(ctx.app).patch(`/api/loans/${paidEarly.id}/repay`).set(alice.auth).expect(200);
    ctx.clock.advanceSeconds(3600);
    await request(ctx.app).patch(`/api/loans/${paidLate.id}/repay`).set(alice.auth).expect(200);

    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    const order = res.body.data.loans.map((l: { friendName: string }) => l.friendName);
    expect(order).toEqual(['Overdue', 'Soon', 'Later', 'PaidLate', 'PaidEarly']);
  });

  it('computes status and daysOverdue on the server, around the due date', async () => {
    await createLoan(ctx, alice, { friendName: 'DueYesterday', amount: 1, dueDate: '2026-10-20' });
    await createLoan(ctx, alice, { friendName: 'DueToday', amount: 1, dueDate: '2026-10-21' });
    await createLoan(ctx, alice, { friendName: 'DueTomorrow', amount: 1, dueDate: '2026-10-22' });
    await createLoan(ctx, alice, { friendName: 'LongOverdue', amount: 1, dueDate: '2026-07-23' });

    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    const byName = Object.fromEntries(
      res.body.data.loans.map((l: { friendName: string; status: string; daysOverdue: number }) => [l.friendName, l]),
    );
    expect(byName.DueYesterday).toMatchObject({ status: 'overdue', daysOverdue: 1 });
    expect(byName.DueToday).toMatchObject({ status: 'outstanding', daysOverdue: 0 });
    expect(byName.DueTomorrow).toMatchObject({ status: 'outstanding', daysOverdue: 0 });
    expect(byName.LongOverdue).toMatchObject({ status: 'overdue', daysOverdue: 90 });
  });

  it('flips a loan to overdue exactly when the application day rolls over (IST midnight)', async () => {
    await createLoan(ctx, alice, { friendName: 'Boundary', amount: 1, dueDate: '2026-10-31' });

    // 10 days past the login in beforeEach, so the original 7-day session has correctly expired:
    // log in again at the instant being tested.
    const user = await loginAs(ctx, PHONE_A, new Date('2026-10-31T18:29:59.000Z')); // 23:59:59 IST on 31 Oct
    let res = await request(ctx.app).get('/api/loans').set(user.auth).expect(200);
    expect(res.body.data.loans[0]).toMatchObject({ status: 'outstanding', daysOverdue: 0 });

    ctx.clock.set(new Date('2026-10-31T18:30:00.000Z')); // 00:00:00 IST on 1 Nov
    res = await request(ctx.app).get('/api/loans').set(user.auth).expect(200);
    expect(res.body.data.loans[0]).toMatchObject({ status: 'overdue', daysOverdue: 1 });
  });

  it('never reports a repaid loan as overdue, however old its due date', async () => {
    const loan = await createLoan(ctx, alice, { amount: 1, dueDate: '2026-01-01' });
    await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth).expect(200);
    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    expect(res.body.data.loans[0]).toMatchObject({ status: 'repaid', daysOverdue: 0 });
  });
});

describe('PATCH /api/loans/:id/repay', () => {
  it('marks an outstanding loan repaid and records the repayment timestamp', async () => {
    const loan = await createLoan(ctx, alice, { amount: 750, dueDate: '2026-10-01' });
    ctx.clock.set(new Date('2026-10-22T08:15:30.000Z'));

    const res = await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth).expect(200);
    expect(res.body.data).toMatchObject({
      id: loan.id,
      status: 'repaid',
      daysOverdue: 0,
      repaidAt: '2026-10-22T08:15:30.000Z',
      amount: '750.00',
    });
  });

  it('persists the change and keeps the row (repayment never deletes)', async () => {
    const loan = await createLoan(ctx, alice, { amount: 750, dueDate: '2026-11-01' });
    await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth).expect(200);

    const rows = await dbLoans();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repaid_at).toBeInstanceOf(Date);
    expect(rows[0]?.amount).toBe('750.00');
  });

  it('handles a repeated repayment with 409 and leaves the original timestamp untouched', async () => {
    const loan = await createLoan(ctx, alice, { amount: 100, dueDate: '2026-11-01' });
    ctx.clock.set(new Date('2026-10-22T09:00:00.000Z'));
    await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth).expect(200);

    ctx.clock.set(new Date('2026-10-23T09:00:00.000Z'));
    const again = await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth).expect(409);
    expect(again.body.error.code).toBe('ALREADY_REPAID');
    expect(again.body.error.details.repaidAt).toBe('2026-10-22T09:00:00.000Z');

    const [row] = await dbLoans();
    expect((row?.repaid_at as Date).toISOString()).toBe('2026-10-22T09:00:00.000Z');
  });

  it('is atomic: five simultaneous repayments produce exactly one success', async () => {
    const loan = await createLoan(ctx, alice, { amount: 100, dueDate: '2026-11-01' });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request(ctx.app).patch(`/api/loans/${loan.id}/repay`).set(alice.auth)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'ALREADY_REPAID')).toBe(true);

    const rows = await dbLoans();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.repaid_at).toBeInstanceOf(Date);
  });

  it('returns 404 and changes nothing when another user’s loan is targeted', async () => {
    const bobsLoan = await createLoan(ctx, bob, { amount: 100, dueDate: '2026-11-01' });
    const res = await request(ctx.app).patch(`/api/loans/${bobsLoan.id}/repay`).set(alice.auth).expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');

    const [row] = await dbLoans();
    expect(row?.repaid_at).toBeNull();
  });

  it('gives the same 404 for a missing loan as for someone else’s (no existence leak)', async () => {
    const bobsLoan = await createLoan(ctx, bob, { amount: 100, dueDate: '2026-11-01' });
    const foreign = await request(ctx.app).patch(`/api/loans/${bobsLoan.id}/repay`).set(alice.auth);
    const missing = await request(ctx.app).patch('/api/loans/11111111-1111-4111-8111-111111111111/repay').set(alice.auth);
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('rejects a malformed loan id with 400', async () => {
    const res = await request(ctx.app).patch('/api/loans/not-a-uuid/repay').set(alice.auth).expect(400);
    expect(res.body.error.details.fields.id).toBeTruthy();
  });

  it('cannot be used to read another user’s loan via the list either', async () => {
    const bobsLoan = await createLoan(ctx, bob, { friendName: 'Secret', amount: 100, dueDate: '2026-11-01' });
    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    expect(JSON.stringify(res.body)).not.toContain(bobsLoan.id);
    expect(JSON.stringify(res.body)).not.toContain('Secret');
  });

  it('requires authentication', async () => {
    const loan = await createLoan(ctx, alice, { amount: 100, dueDate: '2026-11-01' });
    await request(ctx.app).patch(`/api/loans/${loan.id}/repay`).expect(401);
  });
});
