/** Queries one checkout id, without sending another push. */
import { config } from 'dotenv';
import { resolve } from 'node:path';
config({ path: resolve(__dirname, '..', '.env') });

import { queryStkStatus } from '../apps/api/src/services/mpesa';

const id = process.argv[2];
if (!id) throw new Error('usage: daraja_query.ts <checkoutRequestId>');

queryStkStatus(id)
  .then((s) => console.log(`resultCode=${s.resultCode} :: ${s.resultDesc}`))
  .catch((e) => { console.error('FAILED:', e?.message ?? e); process.exit(1); });
