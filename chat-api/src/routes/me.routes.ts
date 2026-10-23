import { Router } from 'express';
import Joi from 'joi';
import { AppError, validateBody } from '../middleware/error';
import { requireAuth } from '../middleware/auth';
import { syncUser, toProfile, updateDisplayName } from '../services/user.service';

const updateProfileSchema = Joi.object({
  displayName: Joi.string().trim().min(1).max(60).required()
});

export const meRouter = Router();

/** Signs the caller in: validates the token, creates/refreshes the profile and returns it. */
meRouter.get('/', requireAuth, async (req, res) => {
  const user = await syncUser(req.user!);
  res.json({ success: true, data: toProfile(user!) });
});

meRouter.patch('/', requireAuth, validateBody(updateProfileSchema), async (req, res) => {
  await syncUser(req.user!);
  const user = await updateDisplayName(req.user!.firebaseUid, req.body.displayName);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Profile not found.');
  res.json({ success: true, data: toProfile(user) });
});
