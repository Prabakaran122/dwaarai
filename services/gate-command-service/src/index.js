import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import routes from './routes.js';
import { connect as mqttConnect } from './mqtt-publisher.js';

const app = express();

app.use(express.json({ limit: '2mb' }));

// Request ID middleware
app.use((req, res, next) => {
  res.locals.requestId = req.headers['x-request-id'] || uuidv4();
  next();
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'gate-command-service' });
});

// Mount routes
app.use('/', routes);

const PORT = process.env.PORT || 3050;

if (process.env.NODE_ENV !== 'test') {
  mqttConnect();
  app.listen(PORT, () => {
    console.log(`gate-command-service listening on :${PORT}`);
  });
}

export default app;
