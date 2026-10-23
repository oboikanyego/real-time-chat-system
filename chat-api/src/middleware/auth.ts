import type { NextFunction, Request, Response } from 'express';
import { resolveIdentity, UnauthorizedError } from '../auth/identity';
import type { AuthenticatedUser } from '../types/auth';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    req.user = await resolveIdentity(token, req.header('x-dev-user'));
    return next();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: error.message } });
    }
    return next(error);
  }
}
