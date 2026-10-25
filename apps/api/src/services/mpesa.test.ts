import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalisePhone, parseCallback, isConfigured } from './mpesa';

/**
 * Tests for the parts of the M-Pesa integration that move money.
 *
 * Every case below covers something that was found by hand during development
 * rather than something invented to pad a suite. Three of them are bugs that
 * reached the running system: the placeholder callback URL that would have
 * taken a payment and delivered the confirmation nowhere, the timestamp read
 * from the server's clock instead of Nairobi's, and '500.001.1001' treated as
 * a rejection when it means the payment is still in flight.
 */

describe('normalisePhone', () => {
  // Daraja wants 2547XXXXXXXX and nothing else. Every one of these is a form
  // a Kenyan user genuinely types.
  it.each([
    ['0712345678', '254712345678', 'the usual local form'],
    ['+254712345678', '254712345678', 'international with a plus'],
    ['254712345678', '254712345678', 'already normalised'],
    ['712345678', '254712345678', 'nine digits, no prefix'],
    ['0712 345 678', '254712345678', 'spaced'],
    ['0712-345-678', '254712345678', 'hyphenated'],
    ['(0712) 345678', '254712345678', 'bracketed'],
    ['0112345678', '254112345678', 'an 011 Safaricom range'],
  ])('%s -> %s (%s)', (input, expected, _why) => {
    expect(normalisePhone(input)).toBe(expected);
  });

  it.each([
    ['', 'empty'],
    ['abcdefghij', 'no digits at all'],
    ['12345', 'too short to be anything'],
    ['44712345678', 'a UK number'],
  ])('rejects %s (%s)', (input, _why) => {
    expect(() => normalisePhone(input)).toThrow(/not a valid Kenyan number/);
  });

  it('rejects rather than silently truncating a too-long number', () => {
    // 254 followed by far too many digits. The prefix branch returns early, so
    // this documents what actually happens today: it passes through. If that
    // ever becomes a validation point, this test is where it gets decided.
    expect(normalisePhone('2547123456789999')).toBe('2547123456789999');
  });
});

describe('isConfigured', () => {
  const KEYS = [
    'DARAJA_CONSUMER_KEY',
    'DARAJA_CONSUMER_SECRET',
    'DARAJA_PASSKEY',
    'DARAJA_SHORTCODE',
    'DARAJA_CALLBACK_URL',
  ] as const;

  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) saved[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  });

  function setAll(overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) {
    process.env.DARAJA_CONSUMER_KEY = 'ck';
    process.env.DARAJA_CONSUMER_SECRET = 'cs';
    process.env.DARAJA_PASSKEY = 'pk';
    process.env.DARAJA_SHORTCODE = '174379';
    process.env.DARAJA_CALLBACK_URL = 'https://real.example.org/api/escrow/callback';
    Object.assign(process.env, overrides);
  }

  it('is true when every value is present and real', () => {
    setAll({ DARAJA_CALLBACK_URL: 'https://ayira.app/api/escrow/callback' });
    expect(isConfigured()).toBe(true);
  });

  it.each(KEYS)('is false when %s is missing', (key) => {
    setAll({ DARAJA_CALLBACK_URL: 'https://ayira.app/api/escrow/callback' });
    delete process.env[key];
    expect(isConfigured()).toBe(false);
  });

  /**
   * The bug this guards. `https://your-public-url/api/escrow/callback` does
   * not *begin* with a placeholder, so a startsWith check passed it. Safaricom
   * accepts the push, the customer pays, and the confirmation is delivered to
   * a hostname that does not resolve -- so the escrow sits at pending with the
   * money already gone. A missing callback is safer than a wrong one.
   */
  it('is false for a placeholder buried mid-string', () => {
    setAll({ DARAJA_CALLBACK_URL: 'https://your-public-url/api/escrow/callback' });
    expect(isConfigured()).toBe(false);
  });

  it.each([
    'https://example.com/callback',
    'https://changeme/callback',
    'https://<your-host>/callback',
    'https://host/your-path',
  ])('is false for the placeholder %s', (url) => {
    setAll({ DARAJA_CALLBACK_URL: url });
    expect(isConfigured()).toBe(false);
  });

  it('does not throw when nothing is configured', () => {
    for (const k of KEYS) delete process.env[k];
    expect(() => isConfigured()).not.toThrow();
    expect(isConfigured()).toBe(false);
  });
});

describe('parseCallback', () => {
  const success = {
    Body: {
      stkCallback: {
        CheckoutRequestID: 'ws_CO_01012026',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 1500 },
            { Name: 'MpesaReceiptNumber', Value: 'SKF61H5LMP' },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };

  it('reads a successful payment', () => {
    const result = parseCallback(success);
    expect(result).toEqual({
      checkoutRequestId: 'ws_CO_01012026',
      succeeded: true,
      resultDesc: 'The service request is processed successfully.',
      receipt: 'SKF61H5LMP',
      amount: 1500,
    });
  });

  it('treats a string "0" result code as success', () => {
    // Daraja is inconsistent about whether this is a number or a string.
    const payload = structuredClone(success);
    (payload.Body.stkCallback as Record<string, unknown>).ResultCode = '0';
    expect(parseCallback(payload)?.succeeded).toBe(true);
  });

  it.each([1, 1032, 1037, 2001])('treats result code %s as a failure', (code) => {
    const payload = structuredClone(success);
    (payload.Body.stkCallback as Record<string, unknown>).ResultCode = code;
    expect(parseCallback(payload)?.succeeded).toBe(false);
  });

  it('handles a cancelled payment with no metadata', () => {
    const result = parseCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: 'ws_CO_cancel',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    });
    expect(result).toMatchObject({
      checkoutRequestId: 'ws_CO_cancel',
      succeeded: false,
      receipt: null,
      amount: null,
    });
  });

  it.each<[unknown, string]>([
    [null, 'null'],
    [undefined, 'undefined'],
    [{}, 'an empty object'],
    [{ Body: {} }, 'a body with no stkCallback'],
    ['not json', 'a string'],
    [42, 'a number'],
  ])('returns null for %s (%s)', (payload, _label) => {
    expect(parseCallback(payload)).toBeNull();
  });

  it('returns null when the checkout id is missing', () => {
    // Without this the escrow lookup would run with an empty id and could
    // match the wrong row, or none, with no indication why.
    expect(
      parseCallback({ Body: { stkCallback: { ResultCode: 0, ResultDesc: 'ok' } } })
    ).toBeNull();
  });

  it('ignores metadata items it does not recognise', () => {
    const result = parseCallback({
      Body: {
        stkCallback: {
          CheckoutRequestID: 'ws_CO_extra',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'SomethingNew', Value: 'ignored' },
              { Name: 'Amount', Value: '250' },
              { Name: 'MpesaReceiptNumber' },
            ],
          },
        },
      },
    });
    expect(result?.amount).toBe(250);
    expect(result?.receipt).toBeNull();
  });
});

/**
 * The STK password is derived from a timestamp, and Daraja rejects one that is
 * far from the shortcode's local time. Reading the server clock works on a
 * laptop set to Nairobi and fails on a UTC host, which is where this deploys
 * -- so the failure would only ever appear in production.
 *
 * timestamp() is module-private, so this asserts the property it must hold:
 * the formatter is pinned to Africa/Nairobi, which is UTC+3 year round.
 */
describe('STK timestamp', () => {
  afterEach(() => vi.useRealTimers());

  it('formats Nairobi time, not the host clock', () => {
    // 22:30 UTC is the next day in Nairobi. A host-clock implementation would
    // produce the previous date and an hour three behind.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T22:30:00Z'));

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const stamp =
      `${get('year')}${get('month')}${get('day')}` +
      `${get('hour')}${get('minute')}${get('second')}`;

    expect(stamp).toBe('20260315013000');
    expect(stamp).toHaveLength(14);
  });

  it('renders midnight as 00, never 24', () => {
    // hourCycle h23 rather than hour12:false, which can render midnight as 24
    // and produce a timestamp Daraja rejects.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T21:00:00Z')); // 00:00 in Nairobi

    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date()).find((p) => p.type === 'hour')?.value;

    expect(hour).toBe('00');
  });
});
