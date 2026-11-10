import { createServer } from './server.js';

process.on('unhandledRejection', (e) => console.error('unhandled', e));

const need = (k) => {
  const v = process.env[k];
  if (!v) { console.error(`${k} is not set`); process.exit(1); }
  return v;
};

const cfg = {
  secret: need('SITE_PROMOTE_SECRET'),
  live: process.env.LIVE_DIR || '/opt/communitygate/landing',
  backups: process.env.BACKUP_DIR || '/opt/communitygate/landing-backups',
  logFile: process.env.LOG_FILE || '/var/lib/site-promoter/promotions.jsonl',
  staging: {
    base: process.env.STAGING_BASE || 'https://staging.dwaarai.com',
    user: need('STAGING_USER'),
    pass: need('STAGING_PASS'),
  },
};

const port = Number(process.env.PORT || 3011);
createServer(cfg).listen(port, '127.0.0.1', () => console.log(`site-promoter on 127.0.0.1:${port}`));
