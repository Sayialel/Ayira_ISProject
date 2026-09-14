import { Router } from 'express';

export const escrowRouter = Router();

// TODO: Implement escrow routes in Phase 2
escrowRouter.get('/', (_req, res) => {
  res.json({ message: 'escrow endpoint ready' });
});
