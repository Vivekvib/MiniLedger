// Creates backend/.env from .env.example with two fresh random secrets, so nobody has to
// generate and paste them by hand. It never overwrites an existing .env.
//
//   npm run setup:env
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const examplePath = join(backendDir, '.env.example');
const envPath = join(backendDir, '.env');

if (existsSync(envPath)) {
  console.log('backend/.env already exists, so it was left exactly as it is.');
  console.log('To start over, rename or delete that file yourself, then run this command again.');
  process.exit(0);
}

const secret = () => randomBytes(32).toString('hex');
const example = readFileSync(examplePath, 'utf8');
const filled = example
  .replace(/^JWT_SECRET=.*$/m, () => `JWT_SECRET=${secret()}`)
  .replace(/^OTP_HMAC_SECRET=.*$/m, () => `OTP_HMAC_SECRET=${secret()}`);

if (/^(JWT_SECRET|OTP_HMAC_SECRET)=(?![0-9a-f]{64}$)/m.test(filled)) {
  console.error('Could not fill in the secrets: .env.example does not look the way this script expects.');
  process.exit(1);
}

writeFileSync(envPath, filled, { mode: 0o600 });
console.log('Created backend/.env with two new random secrets.');
console.log('Keep that file private: never share it, post it online, or commit it to git.');
