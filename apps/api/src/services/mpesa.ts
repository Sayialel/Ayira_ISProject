/**
 * Safaricom Daraja (M-Pesa) client.
 *
 * Covers the three calls escrow needs: an OAuth token, an STK push that makes
 * the payer's phone prompt for their PIN, and a status query for when the
 * callback does not arrive.
 *
 * Sandbox throughout. Nothing here moves real money.
 */
import { AppError } from '../middleware/errorHandler';

const BASE_URL =
  process.env.DARAJA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

const TIMEOUT_MS = Number(process.env.DARAJA_TIMEOUT_MS || 20_000);

/** Values shipped as examples, which must never be sent to Safaricom. */
const PLACEHOLDER = /your-|example\.com|changeme|<[^>]+>/i;

interface DarajaConfig {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  shortcode: string;
  callbackUrl: string;
}

/**
 * Reads and validates configuration at call time rather than at import.
 *
 * The rest of the API must start and serve normally on a machine with no
 * Daraja credentials — only the payment routes should fail, and with a message
 * that names what is missing rather than a generic 500.
 */
function config(): DarajaConfig {
  const values = {
    consumerKey: process.env.DARAJA_CONSUMER_KEY ?? '',
    consumerSecret: process.env.DARAJA_CONSUMER_SECRET ?? '',
    passkey: process.env.DARAJA_PASSKEY ?? '',
    shortcode: process.env.DARAJA_SHORTCODE ?? '',
    callbackUrl: process.env.DARAJA_CALLBACK_URL ?? '',
  };

  // The placeholders shipped in .env.example would otherwise reach Safaricom
  // and come back as an opaque authentication failure.
  //
  // Matched anywhere in the value, not just at the start. The callback URL is
  // why: `https://your-public-url/api/escrow/callback` does not begin with the
  // placeholder, so a prefix check passed it. Safaricom would then accept the
  // push, take the customer's money, and deliver the confirmation to a
  // hostname that does not exist -- leaving the escrow stuck at pending with
  // the payment already made. A missing callback is worse than a missing key.
  const missing = Object.entries(values)
    .filter(([, v]) => !v || PLACEHOLDER.test(v))
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new AppError(
      `M-Pesa is not configured on this server (missing: ${missing.join(', ')}).`,
      503
    );
  }

  return values;
}

/** True when payments can be attempted, so routes can report it without throwing. */
export function isConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

async function darajaFetch(url: string, init: RequestInit, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    console.error(`Daraja ${what} request failed:`, err);
    throw new AppError('Could not reach M-Pesa. Please try again shortly.', 503);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  if (!response.ok) {
    // Safaricom's error bodies carry useful detail but also echo request
    // identifiers, so they are logged rather than returned.
    console.error(`Daraja ${what} returned ${response.status}:`, String(text).slice(0, 400));
    throw new AppError('M-Pesa rejected the request. Please try again.', 502);
  }

  return body;
}

/** OAuth tokens last an hour; re-requesting one per payment is wasteful. */
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const { consumerKey, consumerSecret } = config();
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

  const body = (await darajaFetch(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { method: 'GET', headers: { Authorization: `Basic ${credentials}` } },
    'token'
  )) as { access_token?: string; expires_in?: string };

  if (!body.access_token) {
    throw new AppError('M-Pesa did not return an access token.', 502);
  }

  // Expire a minute early so a token is never used in the moment it lapses.
  const lifetime = Number(body.expires_in || 3599);
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, lifetime - 60) * 1000,
  };

  return cachedToken.value;
}

/**
 * yyyyMMddHHmmss in East Africa Time, which is what Daraja validates against.
 *
 * Explicitly Africa/Nairobi rather than the server's own clock. Daraja checks
 * the password, which is derived from this timestamp, and rejects one that is
 * far from the shortcode's local time. Reading the local clock happens to work
 * on a laptop set to Nairobi and fails on a UTC host -- which is exactly where
 * this gets deployed -- so the bug would appear only in production.
 */
function timestamp(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // h23 rather than hour12:false, which can render midnight as 24.
    hourCycle: 'h23',
  }).formatToParts(new Date());

  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';

  return (
    `${part('year')}${part('month')}${part('day')}` +
    `${part('hour')}${part('minute')}${part('second')}`
  );
}

/**
 * Normalises a Kenyan number to the 2547XXXXXXXX form Daraja expects.
 * Accepts 07…, 7…, +2547… and 2547….
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.length === 9) return `254${digits}`;

  throw new AppError(
    'That phone number is not a valid Kenyan number. Use the 07XXXXXXXX format.',
    400
  );
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  customerMessage: string;
}

/**
 * Sends the payment prompt to the payer's handset.
 *
 * Returns as soon as Safaricom accepts the request — the customer has not paid
 * yet. Payment is confirmed only when the callback arrives, which is why the
 * escrow row stays "pending" until then.
 */
export async function initiateStkPush(
  phone: string,
  amount: number,
  accountRef: string,
  description = 'Ayira escrow funding'
): Promise<StkPushResult> {
  const { shortcode, passkey, callbackUrl } = config();
  const token = await getAccessToken();
  const stamp = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${stamp}`).toString('base64');

  const body = (await darajaFetch(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: stamp,
        TransactionType: 'CustomerPayBillOnline',
        // Daraja rejects decimals on this endpoint.
        Amount: Math.round(amount),
        PartyA: normalisePhone(phone),
        PartyB: shortcode,
        PhoneNumber: normalisePhone(phone),
        CallBackURL: callbackUrl,
        AccountReference: accountRef.slice(0, 12),
        TransactionDesc: description.slice(0, 13),
      }),
    },
    'stk push'
  )) as {
    CheckoutRequestID?: string;
    MerchantRequestID?: string;
    CustomerMessage?: string;
    ResponseCode?: string;
  };

  if (!body.CheckoutRequestID) {
    throw new AppError('M-Pesa did not start the payment. Please try again.', 502);
  }

  return {
    checkoutRequestId: body.CheckoutRequestID,
    merchantRequestId: body.MerchantRequestID ?? '',
    customerMessage: body.CustomerMessage ?? 'Check your phone to authorise the payment.',
  };
}

export interface StkStatus {
  resultCode: string;
  resultDesc: string;
}

/**
 * Asks Safaricom what became of a push.
 *
 * Needed because callbacks can be lost — the tunnel is down, the deployment
 * restarted — and without this a payment that succeeded would leave the escrow
 * stuck at "pending" forever.
 */
export async function queryStkStatus(checkoutRequestId: string): Promise<StkStatus> {
  const { shortcode, passkey } = config();
  const token = await getAccessToken();
  const stamp = timestamp();
  const password = Buffer.from(`${shortcode}${passkey}${stamp}`).toString('base64');

  const body = (await darajaFetch(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: stamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    },
    'status query'
  )) as { ResultCode?: string; ResultDesc?: string };

  return {
    resultCode: String(body.ResultCode ?? ''),
    resultDesc: String(body.ResultDesc ?? ''),
  };
}

/* -------------------------------------------------------------------------- */
/* Callback parsing                                                           */
/* -------------------------------------------------------------------------- */

export interface CallbackResult {
  checkoutRequestId: string;
  succeeded: boolean;
  resultDesc: string;
  receipt: string | null;
  amount: number | null;
}

/**
 * Reads the STK callback body.
 *
 * The payload is deeply nested and its metadata is an untyped name/value list,
 * so this is written defensively: the endpoint is public and must not throw on
 * a malformed body.
 */
export function parseCallback(payload: unknown): CallbackResult | null {
  const stk = (payload as { Body?: { stkCallback?: Record<string, unknown> } })?.Body
    ?.stkCallback;
  if (!stk) return null;

  const checkoutRequestId = String(stk.CheckoutRequestID ?? '');
  if (!checkoutRequestId) return null;

  // ResultCode 0 means the customer authorised the payment. Everything else —
  // cancelled, timed out, insufficient funds — is a failure.
  const resultCode = String(stk.ResultCode ?? '');
  const succeeded = resultCode === '0';

  let receipt: string | null = null;
  let amount: number | null = null;

  const items = (stk.CallbackMetadata as { Item?: unknown[] } | undefined)?.Item;
  if (Array.isArray(items)) {
    for (const entry of items) {
      const item = entry as { Name?: string; Value?: unknown };
      if (item?.Name === 'MpesaReceiptNumber' && item.Value != null) {
        receipt = String(item.Value);
      }
      if (item?.Name === 'Amount' && item.Value != null) {
        amount = Number(item.Value);
      }
    }
  }

  return {
    checkoutRequestId,
    succeeded,
    resultDesc: String(stk.ResultDesc ?? ''),
    receipt,
    amount,
  };
}
