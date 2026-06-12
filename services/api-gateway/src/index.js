import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { createServer } from 'http';
import { requestIdMiddleware } from './middleware/response.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import vehicleRoutes from './routes/vehicles.js';
import passRoutes from './routes/passes.js';
import gateRoutes from './routes/gates.js';
import eventRoutes from './routes/events.js';
import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import notificationRoutes from './routes/notifications.js';
import approvalRoutes from './routes/approvals.js';
import recurringPassRoutes from './routes/recurring-passes.js';
import expectedVisitRoutes from './routes/expected-visits.js';
import memberRoutes from './routes/members.js';
import noticeRoutes from './routes/notices.js';
import dueRoutes from './routes/dues.js';
import faceRoutes from './routes/face.js';
import guardRoutes from './routes/guard.js';
import sosRoutes from './routes/sos.js';
import deliveryRoutes from './routes/deliveries.js';
import residentHomeRoutes from './routes/resident-home.js';
import residentUnitRoutes from './routes/resident-unit.js';
import handoverRoutes from './routes/handover.js';
import staffRoutes from './routes/staff.js';
import incidentRoutes from './routes/incidents.js';
import { startVisitCron } from './cron/generate-visits.js';
import { initWebSocket } from './websocket.js';

const app = express();
const PORT = process.env.PORT_API_GATEWAY || 3000;

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:3001', 'http://localhost:3100', 'http://localhost:19006'];

// Global middleware
app.use(helmet());
app.use(cors({
  origin: CORS_ORIGINS,
  credentials: true,
}));
app.use(express.json({
  limit: '10mb',
  // Preserve the exact bytes so payment webhooks can verify their HMAC signature.
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
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
app.use('/api/v1', adminRoutes);
app.use('/api/v1', notificationRoutes);
app.use('/api/v1', approvalRoutes);
app.use('/api/v1', recurringPassRoutes);
app.use('/api/v1', expectedVisitRoutes);
app.use('/api/v1', memberRoutes);
app.use('/api/v1', noticeRoutes);
app.use('/api/v1', dueRoutes);
app.use('/api/v1', faceRoutes);
app.use('/api/v1', guardRoutes);
app.use('/api/v1', sosRoutes);
app.use('/api/v1', deliveryRoutes);
app.use('/api/v1', residentHomeRoutes);
app.use('/api/v1', residentUnitRoutes);
app.use('/api/v1', handoverRoutes);
app.use('/api/v1', staffRoutes);
app.use('/api/v1', incidentRoutes);

// Serve uploaded visit photos
const UPLOAD_BASE = process.env.UPLOAD_DIR || '/opt/communitygate/uploads';
app.use('/uploads', express.static(UPLOAD_BASE));

// Error handler
app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  const server = createServer(app);
  initWebSocket(server, CORS_ORIGINS);
  server.listen(PORT, () => console.log(`API Gateway listening on port ${PORT}`));
    startVisitCron();
}

export default app;
