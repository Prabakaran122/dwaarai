import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requestIdMiddleware } from './middleware/response.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import vehicleRoutes from './routes/vehicles.js';
import passRoutes from './routes/passes.js';
import gateRoutes from './routes/gates.js';
import eventRoutes from './routes/events.js';
import authRoutes from './routes/auth.js';

const app = express();
const PORT = process.env.PORT_API_GATEWAY || 3000;

// Global middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3001', 'http://localhost:3100', 'http://localhost:19006'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(requestIdMiddleware);
app.use(globalLimiter);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true }));

// API routes
app.use('/api/v1', authRoutes);
app.use('/api/v1', vehicleRoutes);
app.use('/api/v1', passRoutes);
app.use('/api/v1', gateRoutes);
app.use('/api/v1', eventRoutes);

// Error handler
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`API Gateway listening on port ${PORT}`));
}

export default app;
