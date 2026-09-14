import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode: number = 500, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'AppError';
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Zod failures are always client input problems — surface the field errors.
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.errors });
  }

  if (err instanceof AppError) {
    console.error(`AppError ${err.statusCode}:`, err.message);
    return res.status(err.statusCode).json({
      error: err.message,
      ...(err.details !== undefined && { details: err.details }),
    });
  }

  // Anything else is a bug — log it in full but never leak internals to the client.
  console.error('Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
