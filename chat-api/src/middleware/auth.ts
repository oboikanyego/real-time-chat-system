import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { firebaseAuth } from '../config/firebase';
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
    if (env.authMode === 'development' && env.nodeEnv !== 'production') {
      req.user = { firebaseUid: 'dev-user', email: 'dev@example.com' };
      return next();
    }

    const header = req.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing bearer token.' } });
    }

    const decoded = await firebaseAuth()!.verifyIdToken(header.slice(7));
    req.user = { firebaseUid: decoded.uid, email: decoded.email };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired authentication token.' } });
  }
}
