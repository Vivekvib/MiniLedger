import request from 'supertest';
import type { Response } from 'superagent';
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
import { MAX_RECEIPT_BYTES } from '../../src/utils/receipt-image';

let ctx: TestContext;
let alice: LoggedInUser;
let bob: LoggedInUser;
let loanId: string;

const NOW = new Date('2026-10-21T10:00:00.000Z');

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => closeTestContext(ctx));
beforeEach(async () => {
  await resetDatabase(ctx.pool);
  ctx.sender.sent.length = 0;
  ctx.clock.set(NOW);
  alice = await loginAs(ctx, PHONE_A);
  bob = await loginAs(ctx, PHONE_B);
  loanId = (await createLoan(ctx, alice, { amount: '1500.00', dueDate: '2026-11-01' })).id;
});

// --- fixtures: only the first bytes matter to the server, so images are a real header + filler.
const HEADS = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]),
} as const;
type ImageType = keyof typeof HEADS;

const image = (type: ImageType, total = 400, fill = 9) =>
  Buffer.concat([HEADS[type], Buffer.alloc(Math.max(0, total - HEADS[type].length), fill)]);

const put = (user: LoggedInUser | null, id: string, body: unknown) => {
  const req = request(ctx.app).put(`/api/loans/${id}/receipt`);
  return (user ? req.set(user.auth) : req).send(body as object);
};
const upload = (user: LoggedInUser, id: string, type: ImageType, bytes = image(type)) =>
  put(user, id, { contentType: type, data: bytes.toString('base64') });
const get = (user: LoggedInUser | null, id: string) => {
  const req = request(ctx.app).get(`/api/loans/${id}/receipt`).buffer(true).parse(binaryParser);
  return user ? req.set(user.auth) : req;
};
const del = (user: LoggedInUser | null, id: string) => {
  const req = request(ctx.app).delete(`/api/loans/${id}/receipt`);
  return user ? req.set(user.auth) : req;
};

/** Collects a binary response body into a Buffer (supertest would otherwise try to decode it). */
function binaryParser(res: Response, done: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

async function storedReceipt(id = loanId) {
  const { rows } = await ctx.pool.query(
    'SELECT receipt_data, receipt_content_type, receipt_size_bytes, receipt_uploaded_at FROM loans WHERE id = $1',
    [id],
  );
  return rows[0] as {
    receipt_data: Buffer | null;
    receipt_content_type: string | null;
    receipt_size_bytes: number | null;
    receipt_uploaded_at: Date | null;
  };
}

describe('PUT /api/loans/:id/receipt', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'] as const)('stores a %s and returns the loan with receipt details', async (type) => {
    const bytes = image(type, 1234);
    const res = await upload(alice, loanId, type, bytes).expect(200);

    expect(res.body.data).toMatchObject({
      id: loanId,
      friendName: 'Example Friend',
      amount: '1500.00',
      status: 'outstanding',
      receipt: { contentType: type, sizeBytes: 1234, uploadedAt: '2026-10-21T10:00:00.000Z' },
    });
    // The image itself is never part of the loan JSON.
    expect(JSON.stringify(res.body)).not.toContain(bytes.toString('base64').slice(0, 40));

    const row = await storedReceipt();
    expect(row.receipt_content_type).toBe(type);
    expect(row.receipt_size_bytes).toBe(1234);
    expect(row.receipt_data?.equals(bytes)).toBe(true);
  });

  it('a loan starts without a receipt', async () => {
    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    expect(res.body.data.loans[0].receipt).toBeNull();
  });

  it('replaces an existing receipt completely (bytes, type, size and time)', async () => {
    await upload(alice, loanId, 'image/jpeg', image('image/jpeg', 500, 1)).expect(200);
    ctx.clock.advanceSeconds(3600);
    const second = image('image/png', 800, 2);
    const res = await upload(alice, loanId, 'image/png', second).expect(200);

    expect(res.body.data.receipt).toEqual({
      contentType: 'image/png',
      sizeBytes: 800,
      uploadedAt: '2026-10-21T11:00:00.000Z',
    });
    const row = await storedReceipt();
    expect(row.receipt_data?.equals(second)).toBe(true);
    expect(row.receipt_content_type).toBe('image/png');
  });

  it('can be added to a repaid loan, without touching its money or status', async () => {
    await request(ctx.app).patch(`/api/loans/${loanId}/repay`).set(alice.auth).expect(200);
    const res = await upload(alice, loanId, 'image/jpeg').expect(200);

    expect(res.body.data).toMatchObject({ status: 'repaid', amount: '1500.00', receipt: { contentType: 'image/jpeg' } });
    const summary = await request(ctx.app).get('/api/summary').set(alice.auth).expect(200);
    expect(summary.body.data).toMatchObject({ totalLent: '1500.00', totalRepaid: '1500.00', overdueAmount: '0.00' });
  });

  it('does not change anything else about the loan', async () => {
    const before = (await request(ctx.app).get('/api/loans').set(alice.auth)).body.data.loans[0];
    await upload(alice, loanId, 'image/webp').expect(200);
    const after = (await request(ctx.app).get('/api/loans').set(alice.auth)).body.data.loans[0];
    const { receipt: _a, ...beforeRest } = before;
    const { receipt: _b, ...afterRest } = after;
    expect(afterRest).toEqual(beforeRest);
  });

  describe('size limits', () => {
    it('accepts a photo of exactly 5 MiB', async () => {
      const res = await upload(alice, loanId, 'image/jpeg', image('image/jpeg', MAX_RECEIPT_BYTES)).expect(200);
      expect(res.body.data.receipt.sizeBytes).toBe(MAX_RECEIPT_BYTES);
    });

    it('refuses a photo one byte over 5 MiB with a clear message, and stores nothing', async () => {
      const res = await upload(alice, loanId, 'image/jpeg', image('image/jpeg', MAX_RECEIPT_BYTES + 1)).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.fields.data).toMatch(/too large.*5 MB/i);
      expect((await storedReceipt()).receipt_data).toBeNull();
    });

    it('refuses a request body far larger than any photo with 413, without reading it all into memory', async () => {
      const huge = 'A'.repeat(9 * 1024 * 1024);
      const res = await put(alice, loanId, { contentType: 'image/jpeg', data: huge }).expect(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect((await storedReceipt()).receipt_data).toBeNull();
    });

    it('a failed replacement leaves the previous receipt in place', async () => {
      const original = image('image/jpeg', 300, 5);
      await upload(alice, loanId, 'image/jpeg', original).expect(200);
      await upload(alice, loanId, 'image/jpeg', image('image/jpeg', MAX_RECEIPT_BYTES + 1)).expect(400);
      expect((await storedReceipt()).receipt_data?.equals(original)).toBe(true);
    });
  });

  describe('validation', () => {
    const jpeg = () => image('image/jpeg').toString('base64');

    it('requires contentType and data, naming each missing field', async () => {
      const res = await put(alice, loanId, {}).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.error.details.fields).sort()).toEqual(['contentType', 'data']);
    });

    it.each(['image/gif', 'image/svg+xml', 'application/pdf', 'text/html', 'application/octet-stream', 'IMAGE/JPEG', ''])(
      'refuses the content type %j',
      async (contentType) => {
        const res = await put(alice, loanId, { contentType, data: jpeg() }).expect(400);
        expect(res.body.error.details.fields.contentType).toMatch(/image\/jpeg, image\/png or image\/webp/);
      },
    );

    it.each([
      ['an empty string', ''],
      ['only spaces', '    '],
    ])('refuses data that is %s', async (_label, data) => {
      const res = await put(alice, loanId, { contentType: 'image/jpeg', data }).expect(400);
      expect(res.body.error.details.fields.data).toBeDefined();
    });

    it.each([
      ['not base64', 'this is not base64!!'],
      ['a data: URL', `data:image/jpeg;base64,${jpeg()}`],
      ['base64 with a newline inside', `${jpeg().slice(0, 12)}\n${jpeg().slice(12)}`],
      ['URL-safe base64', jpeg().replace(/\+/g, '-').replace(/\//g, '_') + '_-'],
    ])('refuses data that is %s', async (_label, data) => {
      const res = await put(alice, loanId, { contentType: 'image/jpeg', data }).expect(400);
      expect(res.body.error.details.fields.data).toMatch(/base64/i);
    });

    it.each([
      ['a number', 12345],
      ['null', null],
      ['an array', ['a']],
      ['an object', { a: 1 }],
    ])('refuses data that is %s', async (_label, data) => {
      await put(alice, loanId, { contentType: 'image/jpeg', data }).expect(400);
    });

    it.each([
      ['a text file declared as a JPEG', 'image/jpeg', Buffer.from('just some text, not a picture')],
      ['an HTML page declared as a PNG', 'image/png', Buffer.from('<html><script>alert(1)</script></html>')],
      ['an SVG declared as a WebP', 'image/webp', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
      ['a PDF declared as a JPEG', 'image/jpeg', Buffer.from('%PDF-1.7 ...')],
      ['a PNG declared as a JPEG', 'image/jpeg', image('image/png')],
      ['a JPEG declared as a PNG', 'image/png', image('image/jpeg')],
      ['a WebP declared as a JPEG', 'image/jpeg', image('image/webp')],
    ])('refuses %s: the bytes must really be that image type', async (_label, contentType, bytes) => {
      const res = await put(alice, loanId, { contentType, data: bytes.toString('base64') }).expect(400);
      expect(res.body.error.details.fields.data).toMatch(/not a valid (JPEG|PNG|WebP) image/);
      expect((await storedReceipt()).receipt_data).toBeNull();
    });

    it('rejects a body that is not valid JSON', async () => {
      const res = await request(ctx.app)
        .put(`/api/loans/${loanId}/receipt`)
        .set(alice.auth)
        .set('Content-Type', 'application/json')
        .send('{"contentType": "image/jpeg", ')
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_JSON');
    });

    it('rejects a body sent with another content type', async () => {
      const res = await request(ctx.app)
        .put(`/api/loans/${loanId}/receipt`)
        .set(alice.auth)
        .set('Content-Type', 'image/jpeg')
        .send(image('image/jpeg'))
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a loan id that is not a UUID', async () => {
      const res = await upload(alice, 'not-a-uuid', 'image/jpeg').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('ownership and authentication', () => {
    it("404s for someone else's loan, and does not change it", async () => {
      const res = await upload(bob, loanId, 'image/jpeg').expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect((await storedReceipt()).receipt_data).toBeNull();
    });

    it('404s for a loan that does not exist', async () => {
      await upload(alice, '00000000-0000-4000-8000-000000000000', 'image/jpeg').expect(404);
    });

    it('401s without a token, even when the body is huge (it is never read)', async () => {
      const huge = 'A'.repeat(9 * 1024 * 1024);
      const res = await put(null, loanId, { contentType: 'image/jpeg', data: huge }).expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('401s after logout (session revocation applies here too)', async () => {
      await request(ctx.app).post('/api/auth/logout').set(alice.auth).expect(200);
      await upload(alice, loanId, 'image/jpeg').expect(401);
      await get(alice, loanId).expect(401);
      await del(alice, loanId).expect(401);
    });
  });

  it('keeps every other route limited to a small body', async () => {
    const big = { friendName: 'x'.repeat(20 * 1024), amount: '1', dueDate: '2026-11-01' };
    const res = await request(ctx.app).post('/api/loans').set(alice.auth).send(big).expect(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('GET /api/loans/:id/receipt', () => {
  it('returns the exact bytes with the right headers', async () => {
    const bytes = image('image/png', 2048, 3);
    await upload(alice, loanId, 'image/png', bytes).expect(200);

    const res = await get(alice, loanId).expect(200);
    expect(Buffer.isBuffer(res.body) && res.body.equals(bytes)).toBe(true);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-length']).toBe('2048');
    expect(res.headers['content-disposition']).toBe('inline');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('serves the replacement, not the original', async () => {
    await upload(alice, loanId, 'image/jpeg', image('image/jpeg', 300, 1)).expect(200);
    const second = image('image/webp', 500, 2);
    await upload(alice, loanId, 'image/webp', second).expect(200);

    const res = await get(alice, loanId).expect(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect((res.body as Buffer).equals(second)).toBe(true);
  });

  it('404s when the loan has no receipt', async () => {
    const res = await request(ctx.app).get(`/api/loans/${loanId}/receipt`).set(alice.auth).expect(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Receipt not found.' });
  });

  it("404s for someone else's receipt (it is never revealed)", async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    await request(ctx.app).get(`/api/loans/${loanId}/receipt`).set(bob.auth).expect(404);
  });

  it('401s without a token', async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    await request(ctx.app).get(`/api/loans/${loanId}/receipt`).expect(401);
  });

  it('rejects a loan id that is not a UUID', async () => {
    await request(ctx.app).get('/api/loans/nope/receipt').set(alice.auth).expect(400);
  });
});

describe('GET /api/loans (list) with receipts', () => {
  it('shows receipt details for loans that have one and null for those that do not, never the image', async () => {
    const other = (await createLoan(ctx, alice, { friendName: 'No Receipt', amount: '10.00', dueDate: '2026-12-01' })).id;
    const bytes = image('image/jpeg', 4000, 4);
    await upload(alice, loanId, 'image/jpeg', bytes).expect(200);

    const res = await request(ctx.app).get('/api/loans').set(alice.auth).expect(200);
    const byId = Object.fromEntries(res.body.data.loans.map((l: { id: string }) => [l.id, l]));
    expect(byId[loanId].receipt).toMatchObject({ contentType: 'image/jpeg', sizeBytes: 4000 });
    expect(byId[other].receipt).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(bytes.toString('base64').slice(20, 60));
    expect(JSON.stringify(res.body)).not.toMatch(/receipt_data|"data":"/);
  });

  it("does not show one user's receipt details to another", async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    const res = await request(ctx.app).get('/api/loans').set(bob.auth).expect(200);
    expect(res.body.data.loans).toEqual([]);
  });
});

describe('DELETE /api/loans/:id/receipt', () => {
  it('removes the receipt and returns the loan without it', async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    const res = await del(alice, loanId).expect(200);

    expect(res.body.data).toMatchObject({ id: loanId, receipt: null });
    const row = await storedReceipt();
    expect(row).toEqual({ receipt_data: null, receipt_content_type: null, receipt_size_bytes: null, receipt_uploaded_at: null });
    await get(alice, loanId).expect(404);
  });

  it('is safe to repeat: removing a receipt that is not there succeeds', async () => {
    await del(alice, loanId).expect(200);
    await del(alice, loanId).expect(200);
  });

  it('a new receipt can be added after removal', async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    await del(alice, loanId).expect(200);
    const res = await upload(alice, loanId, 'image/png').expect(200);
    expect(res.body.data.receipt.contentType).toBe('image/png');
  });

  it("404s for someone else's loan, and does not remove their receipt", async () => {
    await upload(alice, loanId, 'image/jpeg').expect(200);
    await del(bob, loanId).expect(404);
    expect((await storedReceipt()).receipt_data).not.toBeNull();
  });

  it('404s for a loan that does not exist', async () => {
    await del(alice, '00000000-0000-4000-8000-000000000000').expect(404);
  });
});

describe('database constraints (the last line of defence)', () => {
  const insert = (columns: string, values: unknown[]) =>
    ctx.pool.query(`UPDATE loans SET ${columns} WHERE id = $1`, [loanId, ...values]);

  it('refuses a receipt with some of its columns missing', async () => {
    await expect(insert('receipt_data = $2', [Buffer.from('x')])).rejects.toMatchObject({
      constraint: 'loans_receipt_all_or_none',
    });
  });

  it('refuses a content type other than JPEG, PNG or WebP', async () => {
    await expect(
      insert(
        'receipt_data = $2, receipt_content_type = $3, receipt_size_bytes = 1, receipt_uploaded_at = now()',
        [Buffer.from('x'), 'image/gif'],
      ),
    ).rejects.toMatchObject({ constraint: 'loans_receipt_content_type' });
  });

  it('refuses a recorded size that differs from the real size', async () => {
    await expect(
      insert(
        'receipt_data = $2, receipt_content_type = $3, receipt_size_bytes = 99, receipt_uploaded_at = now()',
        [Buffer.from('xyz'), 'image/jpeg'],
      ),
    ).rejects.toMatchObject({ constraint: 'loans_receipt_size' });
  });

  it('refuses an image over 5 MiB', async () => {
    const big = Buffer.alloc(MAX_RECEIPT_BYTES + 1, 1);
    await expect(
      insert(
        'receipt_data = $2, receipt_content_type = $3, receipt_size_bytes = $4, receipt_uploaded_at = now()',
        [big, 'image/jpeg', big.length],
      ),
    ).rejects.toMatchObject({ constraint: 'loans_receipt_size' });
  });
});
