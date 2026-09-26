// Must stay first: it loads .env before any module reads process.env.
import { env } from './lib/env';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { authRouter } from './routes/auth';
import { gigRouter } from './routes/gigs';
import { workerRouter } from './routes/workers';
import { applicationRouter } from './routes/applications';
import { escrowRouter } from './routes/escrow';
import { adminRouter } from './routes/admin';
import { matchingRouter } from './routes/matching';
import { errorHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { authLimiter, apiLimiter } from './middleware/rateLimit';

const app = express();

// Rate limiting identifies clients by IP. Behind Railway's proxy the socket
// address is the proxy's, so the first X-Forwarded-For hop must be trusted —
// but only in production, where we know a proxy is actually in front. Trusting
// it in development would let any client spoof its own address.
if (env.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}

// Global middleware
app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '100kb' }));
app.use(morgan('dev'));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ayira-api', timestamp: new Date().toISOString() });
});

// Public routes — the only ones reachable without a token, so the strictest
// budget applies here.
app.use('/api/auth', authLimiter, authRouter);

// Protected routes
app.use('/api', apiLimiter);
app.use('/api/gigs', authMiddleware, gigRouter);
app.use('/api/workers', authMiddleware, workerRouter);
app.use('/api/applications', authMiddleware, applicationRouter);
app.use('/api/escrow', authMiddleware, escrowRouter);
app.use('/api/admin', authMiddleware, adminRouter);
app.use('/api/match', authMiddleware, matchingRouter);

// Unknown API paths should be a clean 404 rather than falling through.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use(errorHandler);

app.listen(env.apiPort, () => {
  console.log(`🚀 Ayira API running on http://localhost:${env.apiPort}`);
});

export default app;
