import { Router } from 'express';
import Joi from 'joi';
import { isValidObjectId } from 'mongoose';
import { requireAuth } from '../middleware/auth';
import { AppError, validateQuery } from '../middleware/error';
import { findUserById, searchUsers } from '../services/directory.service';

const searchSchema = Joi.object({
  q: Joi.string().trim().max(100).allow('').default(''),
  page: Joi.number().integer().min(1).max(100).default(1),
  limit: Joi.number().integer().min(1).max(50).default(20)
});

export const usersRouter = Router();
usersRouter.use(requireAuth);

/** Directory search: other users only, paginated by page number. */
usersRouter.get('/', validateQuery(searchSchema), async (req, res) => {
  const { q, page, limit } = res.locals['query'];
  const result = await searchUsers(req.user!.firebaseUid, { q, page, limit });
  res.json({ success: true, data: result.users, meta: { page: result.page, limit: result.limit, hasMore: result.hasMore } });
});

usersRouter.get('/:id', async (req, res) => {
  const id = String(req.params['id']);
  const user = isValidObjectId(id) ? await findUserById(id) : null;
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found.');
  res.json({ success: true, data: user });
});
