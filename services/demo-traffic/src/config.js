/**
 * Every constant that ties this package to one specific tenant.
 *
 * The community UUID is fixed rather than looked up by name so that a typo in a
 * name can never point the generator at a real society.
 */
export const DEMO_COMMUNITY_ID = '00000000-0000-0000-0000-000000000043';

export const GATES = [
  { id: '00000000-0000-0000-0000-000000043001', name: 'Main Entry',        type: 'entry',   share: 0.55 },
  { id: '00000000-0000-0000-0000-000000043002', name: 'Exit Gate',         type: 'exit',    share: 0.30 },
  { id: '00000000-0000-0000-0000-000000043003', name: 'Service & Vendor',  type: 'service', share: 0.15 },
];

export function assertDemoCommunity(id) {
  if (id !== DEMO_COMMUNITY_ID) {
    throw new Error(
      `refusing to operate on community ${id} — this tool only ever touches ${DEMO_COMMUNITY_ID}`
    );
  }
}

export function config(env) {
  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  return {
    apiBase: env.API_BASE || 'http://127.0.0.1:3000/api/v1',
    databaseUrl: env.DATABASE_URL || '',
    jwtSecret: env.JWT_SECRET,
    dryRun: env.DRY_RUN === 'true',
  };
}
