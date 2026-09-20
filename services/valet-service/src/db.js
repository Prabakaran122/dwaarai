import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  min: parseInt(process.env.DATABASE_POOL_MIN || '2'),
  max: parseInt(process.env.DATABASE_POOL_MAX || '10'),
});

pool.on('error', (err) => {
  console.error('Unexpected pool error', err);
});

export default pool;

export async function query(text, params) {
  return pool.query(text, params);
}

export async function queryOne(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}

export async function queryRows(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
