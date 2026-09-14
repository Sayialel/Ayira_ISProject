import { Response, NextFunction, RequestHandler } from 'express';
import { AuthRequest } from '../middleware/auth';

type AsyncRouteHandler = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Express 4 does not catch rejected promises from async handlers, which would
 * leave the request hanging. Wrapping forwards them to the error middleware.
 */
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    handler(req as AuthRequest, res, next).catch(next);
  };
}
