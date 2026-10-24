import { loadConfig } from '../../src/config/env';

const SECRET_A = 'a'.repeat(40);
const SECRET_B = 'b'.repeat(40);

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/miniledger_dev',
  JWT_SECRET: SECRET_A,
  OTP_HMAC_SECRET: SECRET_B,
};

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = loadConfig({ ...base });
    expect(config).toMatchObject({
      env: 'development',
      port: 4000,
      appTimezone: 'Asia/Kolkata',
      otpTtlSeconds: 300,
      otpMaxAttempts: 5,
      otpResendCooldownSeconds: 60,
      otpMaxRequestsPerHour: 5,
      jwtTtlSeconds: 604800,
      databaseUrl: base.DATABASE_URL,
    });
  });

  it('in test mode uses TEST_DATABASE_URL and ignores DATABASE_URL entirely', () => {
    const config = loadConfig({
      ...base,
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgres://u:p@localhost:5432/miniledger_test',
    });
    expect(config.databaseUrl).toBe('postgres://u:p@localhost:5432/miniledger_test');
    expect(config.databaseUrl).not.toBe(base.DATABASE_URL);
  });

  it('in test mode refuses to start without TEST_DATABASE_URL, even if DATABASE_URL is set', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'test' })).toThrow(/TEST_DATABASE_URL/);
  });

  it('requires DATABASE_URL outside test mode', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => loadConfig({ ...rest })).toThrow(/DATABASE_URL/);
  });

  it('rejects short secrets', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: 'short' })).toThrow(/at least 32 characters/);
  });

  it('rejects the placeholder secrets from .env.example', () => {
    expect(() => loadConfig({ ...base, JWT_SECRET: `REPLACE_ME_${'x'.repeat(40)}` })).toThrow(/placeholder/);
  });

  it('rejects identical JWT and OTP secrets', () => {
    expect(() => loadConfig({ ...base, OTP_HMAC_SECRET: SECRET_A })).toThrow(/must be different/);
  });

  it('rejects an invalid APP_TIMEZONE at startup', () => {
    expect(() => loadConfig({ ...base, APP_TIMEZONE: 'Not/AZone' })).toThrow(/not a valid IANA time zone/);
  });

  it('accepts a different valid timezone', () => {
    expect(loadConfig({ ...base, APP_TIMEZONE: 'America/New_York' }).appTimezone).toBe('America/New_York');
  });

  it('rejects an out-of-range port', () => {
    expect(() => loadConfig({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('parses a comma-separated CORS origin list', () => {
    const config = loadConfig({ ...base, CORS_ORIGINS: 'http://localhost:8081, http://example.test ,' });
    expect(config.corsOrigins).toEqual(['http://localhost:8081', 'http://example.test']);
  });

  it('lists every problem at once', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(/JWT_SECRET[\s\S]*OTP_HMAC_SECRET/);
  });
});
