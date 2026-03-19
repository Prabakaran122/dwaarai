import pool from './pool.js';

export async function query(text, params) {
  const result = await pool.query(text, params);
  return result;
}

export async function queryOne(text, params) {
  const result = await pool.query(text, params);
  return result.rows[0] || null;
}

export async function queryRows(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}
