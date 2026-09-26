import rateLimit from 'express-rate-limit';

/**
 * Sign-in and signup are the endpoints worth guessing against, so they get a
 * tight budget. Counting only failures means a person legitimately signing in
 * on several devices is never penalised, while someone working through a
 * password list exhausts it quickly.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many attempts. Please wait 15 minutes before trying again.',
  },
});

/**
 * A wider ceiling for everything else. This is about protecting the service
 * from a runaway client or a crude scraper, not about policing normal use —
 * a busy session browsing gigs stays well inside it.
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please slow down and try again shortly.',
  },
});
