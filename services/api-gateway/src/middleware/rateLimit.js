import rateLimit from 'express-rate-limit';

export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests' } },
});

export const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.headers['x-device-token'] || req.ip,
  message: { success: false, error: { message: 'Too many requests from this device' } },
});
