import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Schema } from 'joi';

export class AppError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const validateBody = (schema: Schema): RequestHandler => (req, _res, next) => {
  const { value, error } = schema.validate(req.body, { abortEarly: false, stripUnknown: true });
  if (error) return next(new AppError(400, 'VALIDATION_ERROR', error.details.map((d) => d.message).join('; ')));
  req.body = value;
  return next();
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof AppError) {
    return res.status(error.status).json({ success: false, error: { code: error.code, message: error.message } });
  }
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed JSON body.' } });
  }
  console.error('[api] unhandled error', req.method, req.path, error);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error.' } });
};
