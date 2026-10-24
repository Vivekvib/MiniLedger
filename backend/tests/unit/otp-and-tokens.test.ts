import jwt from 'jsonwebtoken';
import { generateOtp, hashesMatch, hashOtp } from '../../src/modules/auth/otp';
import { createConsoleOtpSender } from '../../src/modules/auth/otp-sender';
import { signAccessToken, verifyAccessToken } from '../../src/modules/auth/tokens';

describe('generateOtp', () => {
  it('always produces exactly six digits, including leading zeros', () => {
    for (let i = 0; i < 2000; i++) {
      expect(generateOtp()).toMatch(/^\d{6}$/);
    }
  });

  it('is not constant', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe('hashOtp / hashesMatch', () => {
  const secret = 's'.repeat(40);
  const phone = '+911234567890';

  it('is deterministic for the same inputs', () => {
    expect(hashOtp(secret, phone, '123456')).toBe(hashOtp(secret, phone, '123456'));
  });

  it('does not contain the code and is a 64-char hex digest', () => {
    const digest = hashOtp(secret, phone, '123456');
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain('123456');
  });

  it('depends on the secret, so the table alone cannot be brute-forced', () => {
    expect(hashOtp('a'.repeat(40), phone, '123456')).not.toBe(hashOtp('b'.repeat(40), phone, '123456'));
  });

  it('is bound to the phone number', () => {
    expect(hashOtp(secret, '+911234567890', '123456')).not.toBe(hashOtp(secret, '+919876543210', '123456'));
  });

  it('compares in a length-safe way', () => {
    const digest = hashOtp(secret, phone, '123456');
    expect(hashesMatch(digest, digest)).toBe(true);
    expect(hashesMatch(digest, hashOtp(secret, phone, '654321'))).toBe(false);
    expect(hashesMatch(digest, 'abcd')).toBe(false);
    expect(hashesMatch(digest, '')).toBe(false);
  });
});

describe('console OTP sender', () => {
  it('refuses to be constructed in production', () => {
    expect(() => createConsoleOtpSender('production')).toThrow(/development-only mock/);
  });

  it('prints a masked phone and the code to stdout in development', async () => {
    const writes: string[] = [];
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      await createConsoleOtpSender('development').send('+911234567890', '042917', 300);
    } finally {
      spy.mockRestore();
    }
    const output = writes.join('');
    expect(output).toContain('042917');
    expect(output).toContain('+91••••••7890');
    expect(output).not.toContain('+911234567890');
  });
});

describe('access tokens', () => {
  const secret = 'k'.repeat(40);
  const issuedAt = new Date('2026-10-21T10:00:00.000Z');
  const params = { secret, userId: 'user-1', sessionId: 'session-1', issuedAt, ttlSeconds: 3600 };

  it('round-trips claims and reports the expiry', () => {
    const { token, expiresAt } = signAccessToken(params);
    expect(expiresAt.toISOString()).toBe('2026-10-21T11:00:00.000Z');
    expect(verifyAccessToken(secret, token, issuedAt)).toEqual({ userId: 'user-1', sessionId: 'session-1' });
  });

  it('signs with HS256', () => {
    const { token } = signAccessToken(params);
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe('HS256');
  });

  it('rejects a token past its expiry, judged by the injected clock', () => {
    const { token } = signAccessToken(params);
    expect(verifyAccessToken(secret, token, new Date('2026-10-21T10:59:59.000Z'))).not.toBeNull();
    expect(verifyAccessToken(secret, token, new Date('2026-10-21T11:00:00.000Z'))).toBeNull();
  });

  it('rejects a wrong secret and a tampered payload', () => {
    const { token } = signAccessToken(params);
    expect(verifyAccessToken('z'.repeat(40), token, issuedAt)).toBeNull();

    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: 'someone-else', jti: 'session-1', iat: 1, exp: 9999999999 })).toString('base64url');
    expect(verifyAccessToken(secret, `${header}.${forgedPayload}.${signature}`, issuedAt)).toBeNull();
  });

  it('rejects alg:none tokens', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1', jti: 'session-1', exp: 9999999999 })).toString('base64url');
    expect(verifyAccessToken(secret, `${header}.${payload}.`, issuedAt)).toBeNull();
  });

  it('rejects tokens signed with a different HMAC algorithm', () => {
    const hs512 = jwt.sign({ sub: 'user-1', jti: 'session-1' }, secret, { algorithm: 'HS512', expiresIn: 3600 });
    expect(verifyAccessToken(secret, hs512, new Date())).toBeNull();
  });

  it('rejects tokens missing required claims and non-tokens', () => {
    const noJti = jwt.sign({ sub: 'user-1' }, secret, { algorithm: 'HS256', expiresIn: 3600 });
    expect(verifyAccessToken(secret, noJti, new Date())).toBeNull();
    expect(verifyAccessToken(secret, 'not-a-jwt', new Date())).toBeNull();
    expect(verifyAccessToken(secret, '', new Date())).toBeNull();
  });
});
