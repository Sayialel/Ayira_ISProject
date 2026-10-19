/**
 * Exercises the real Daraja sandbox: token, STK push, status query.
 *
 * Run:  npx tsx scripts/daraja_smoke.ts [phone]
 *
 * This is the part of the payment path that cannot be tested without
 * credentials. The escrow state machine around it is already covered by SQL
 * tests; what this proves is that our requests are shaped the way Safaricom
 * expects and that the credentials work.
 *
 * It deliberately does not touch the database. A push here is a real sandbox
 * transaction, so it stays separate from anything that records money.
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// The monorepo keeps one .env at its root, and this script may be run from
// anywhere, so the path is resolved rather than left to the working directory.
config({ path: resolve(__dirname, '..', '.env') });
import { getAccessToken, initiateStkPush, queryStkStatus, normalisePhone } from '../apps/api/src/services/mpesa';

const phone = process.argv[2] ?? '254708374149'; // Safaricom's documented sandbox MSISDN

async function main() {
  console.log('phone:', normalisePhone(phone));

  console.log('\n1. OAuth token');
  const token = await getAccessToken();
  console.log('   got token:', token.slice(0, 12) + '...');

  console.log('\n2. STK push (1 KES)');
  const push = await initiateStkPush(phone, 1, 'AyiraTest', 'Ayira test');
  console.log('   checkoutRequestId:', push.checkoutRequestId);
  console.log('   merchantRequestId:', push.merchantRequestId);
  console.log('   customerMessage  :', push.customerMessage);

  console.log('\n3. Status query (Safaricom needs a moment before it answers)');
  for (const wait of [8000, 10000, 12000]) {
    await new Promise((r) => setTimeout(r, wait));
    const status = await queryStkStatus(push.checkoutRequestId);
    console.log(`   resultCode=${status.resultCode} :: ${status.resultDesc}`);
    if (status.resultCode !== null && status.resultCode !== '1032') break;
  }
}

main().catch((e) => {
  console.error('\nFAILED:', e?.message ?? e);
  process.exit(1);
});
