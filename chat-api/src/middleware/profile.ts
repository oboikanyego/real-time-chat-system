import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';
import { User } from '../models/user.model';
import { syncUser } from '../services/user.service';

declare global {
  namespace Express {
    interface Request {
      /** MongoDB _id of the authenticated user's profile. */
      profileId?: Types.ObjectId;
    }
  }
}

/** Resolves the caller's profile id; use after requireAuth. Creates the profile if the user never hit /me. */
export const requireProfile: RequestHandler = async (req, _res, next) => {
  const existing = await User.findOne({ firebaseUid: req.user!.firebaseUid }, { _id: 1 }).lean();
  req.profileId = existing?._id ?? (await syncUser(req.user!))._id;
  next();
};
