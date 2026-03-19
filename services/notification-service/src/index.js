import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import routes from './routes.js';

const app = express();

app.use(express.json({ limit: '2mb' }));

// Request ID middleware
app.use((req, res, next) => {
  res.locals.requestId = req.headers['x-request-id'] || uuidv4();
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'notification-service' });
});

// Mount routes
app.use('/', routes);

const PORT = process.env.PORT_NOTIFICATION || process.env.PORT || 3004;

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`notification-service listening on :${PORT}`);
  });
}

export default app;
