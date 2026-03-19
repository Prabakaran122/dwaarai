import { error as errorResponse } from './response.js';

export function errorHandler(err, req, res, _next) {
  console.error(`[${res.locals.requestId}] Error:`, err.message);
  const status = err.statusCode || err.status || 500;
  errorResponse(res, err.message || 'Internal server error', status);
}
