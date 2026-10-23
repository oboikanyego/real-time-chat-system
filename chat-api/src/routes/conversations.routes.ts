import { Router } from 'express';
import Joi from 'joi';
import { requireAuth } from '../middleware/auth';
import { AppError, validateBody, validateQuery } from '../middleware/error';
import { historyQuerySchema, listMessages, sendMessage, sendMessageSchema } from '../services/message.service';
import { requireProfile } from '../middleware/profile';
import { getConversation, listConversations, openDirectConversation } from '../services/conversation.service';

const openSchema = Joi.object({ userId: Joi.string().hex().length(24).required() });
const listSchema = Joi.object({
  page: Joi.number().integer().min(1).max(100).default(1),
  limit: Joi.number().integer().min(1).max(50).default(30)
});

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth, requireProfile);

/** Idempotent: 201 when a new conversation was created, 200 when it already existed. */
conversationsRouter.post('/', validateBody(openSchema), async (req, res) => {
  const { created, conversation } = await openDirectConversation(req.profileId!, req.body.userId);
  res.status(created ? 201 : 200).json({ success: true, data: conversation });
});

conversationsRouter.get('/', validateQuery(listSchema), async (req, res) => {
  const { page, limit } = res.locals['query'];
  const result = await listConversations(req.profileId!, { page, limit });
  res.json({ success: true, data: result.conversations, meta: { page, limit, hasMore: result.hasMore } });
});

conversationsRouter.get('/:id', async (req, res) => {
  const conversation = await getConversation(req.profileId!, String(req.params['id']));
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  res.json({ success: true, data: conversation });
});

/** Newest page first by default; pass `before` (a message id) for older pages. */
conversationsRouter.get('/:id/messages', validateQuery(historyQuerySchema), async (req, res) => {
  const { before, limit } = res.locals['query'];
  const result = await listMessages(req.profileId!, String(req.params['id']), { before, limit });
  res.json({ success: true, data: result.messages, meta: { limit, hasMore: result.hasMore } });
});

/** REST fallback for the `message:send` socket event; idempotent on clientMessageId. */
conversationsRouter.post('/:id/messages', validateBody(sendMessageSchema), async (req, res) => {
  const { message, duplicate } = await sendMessage(req.profileId!, String(req.params['id']), req.body);
  res.status(duplicate ? 200 : 201).json({ success: true, data: message });
});
