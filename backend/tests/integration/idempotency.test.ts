import request from 'supertest';
import {
  PHONE_A,
  PHONE_B,
  closeTestContext,
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
  ctx.clock.set(new Date('2026-10-21T10:00:00.000Z'));
  alice = await loginAs(ctx, PHONE_A);
  bob = await loginAs(ctx, PHONE_B);
});

const KEY_1 = '9b2f1c4e-6a7d-4e3b-8c1a-0d5e7f9a1b23';
const KEY_2 = 'c3d4e5f6-0718-4293-a4b5-c6d7e8f90a1b';
const loan = { friendName: 'Example Friend', amount: '1500.00', dueDate: '2026-11-01' };

const create = (user: LoggedInUser, key: string | undefined, body: object = loan) => {
  const req = request(ctx.app).post('/api/loans').set(user.auth);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
};

const loanCount = async (): Promise<number> => (await ctx.pool.query('SELECT count(*)::int AS n FROM loans')).rows[0].n;

describe('POST /api/loans with Idempotency-Key', () => {
  it('creates the loan once and replays the original when the same request is retried', async () => {
    const first = await create(alice, KEY_1).expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    // The client never saw the first response (it was lost) and retries with the same key.
    const retry = await create(alice, KEY_1).expect(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data).toEqual(first.body.data);
    expect(await loanCount()).toBe(1);
  });

  it('survives many retries: still exactly one loan', async () => {
    const original = await create(alice, KEY_1).expect(201);
    for (let i = 0; i < 4; i++) {
      const retry = await create(alice, KEY_1).expect(200);
      expect(retry.body.data.id).toBe(original.body.data.id);
    }
    expect(await loanCount()).toBe(1);
  });

  it('is race-safe: simultaneous retries with one key create a single loan', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => create(alice, KEY_1)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 200, 201]);
    expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
    expect(await loanCount()).toBe(1);
  });

  it('replays the CURRENT state of the loan, e.g. after it was repaid in the meantime', async () => {
    const first = await create(alice, KEY_1).expect(201);
    await request(ctx.app).patch(`/api/loans/${first.body.data.id}/repay`).set(alice.auth).expect(200);

    const retry = await create(alice, KEY_1).expect(200);
    expect(retry.body.data.status).toBe('repaid');
    expect(retry.body.data.repaidAt).not.toBeNull();
    expect(await loanCount()).toBe(1);
  });

  it('rejects reuse of a key for DIFFERENT loan details instead of returning an unrelated loan', async () => {
    await create(alice, KEY_1).expect(201);

    for (const changed of [
      { ...loan, amount: '1600.00' },
      { ...loan, friendName: 'Someone Else' },
      { ...loan, dueDate: '2026-11-02' },
    ]) {
      const res = await create(alice, KEY_1, changed).expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    }
    expect(await loanCount()).toBe(1);
  });

  it('treats equivalent spellings of the same loan as the same request', async () => {
    const first = await create(alice, KEY_1, { ...loan, amount: 1500 }).expect(201);
    const retry = await create(alice, KEY_1, { ...loan, amount: '1500', friendName: '  Example Friend ' }).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it('different keys create different loans, even with identical details', async () => {
    const a = await create(alice, KEY_1).expect(201);
    const b = await create(alice, KEY_2).expect(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    expect(await loanCount()).toBe(2);
  });

  it('scopes keys to the user: another user can use the same key independently', async () => {
    const a = await create(alice, KEY_1).expect(201);
    const b = await create(bob, KEY_1).expect(201);
    expect(a.body.data.id).not.toBe(b.body.data.id);
    expect(a.body.data.userId).toBe(alice.userId);
    expect(b.body.data.userId).toBe(bob.userId);
  });

  it('never leaks one user’s loan to another through a shared key', async () => {
    await create(alice, KEY_1, { ...loan, friendName: 'Alice Private' }).expect(201);
    const res = await create(bob, KEY_1, { ...loan, friendName: 'Bob Own', amount: '5.00' }).expect(201);
    expect(res.body.data.friendName).toBe('Bob Own');
    expect(JSON.stringify(res.body)).not.toContain('Alice Private');
  });

  it('is case-insensitive about the key', async () => {
    const first = await create(alice, KEY_1).expect(201);
    const retry = await create(alice, KEY_1.toUpperCase()).expect(200);
    expect(retry.body.data.id).toBe(first.body.data.id);
  });

  it.each([['not-a-uuid'], ['12345'], ['9b2f1c4e-6a7d-4e3b-8c1a-0d5e7f9a1b2'], ['9b2f1c4e-6a7d-4e3b-8c1a-0d5e7f9a1b23-extra']])(
    'rejects malformed key %p with 400',
    async (key) => {
      const res = await create(alice, key).expect(400);
      expect(res.body.error.details.fields['Idempotency-Key']).toMatch(/UUID/);
      expect(await loanCount()).toBe(0);
    },
  );

  it('still validates the body when a key is present, and does not burn the key on failure', async () => {
    await create(alice, KEY_1, { ...loan, amount: -1 }).expect(400);
    expect(await loanCount()).toBe(0);
    // The same key remains usable for a corrected request.
    await create(alice, KEY_1).expect(201);
  });

  it('without a key, behaviour is unchanged: identical requests create separate loans', async () => {
    await create(alice, undefined).expect(201);
    await create(alice, undefined).expect(201);
    expect(await loanCount()).toBe(2);
  });

  it('stores the key on the row and keeps it unique per user at the database level', async () => {
    await create(alice, KEY_1).expect(201);
    const { rows } = await ctx.pool.query('SELECT idempotency_key FROM loans');
    expect(rows[0].idempotency_key).toBe(KEY_1);

    await expect(
      ctx.pool.query(
        `INSERT INTO loans (user_id, friend_name, amount, due_date, idempotency_key)
         VALUES ($1, 'Dup', 1, '2026-11-01', $2)`,
        [alice.userId, KEY_1],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('does not expose the key in the response body', async () => {
    const res = await create(alice, KEY_1).expect(201);
    expect(JSON.stringify(res.body)).not.toContain(KEY_1);
  });
});
