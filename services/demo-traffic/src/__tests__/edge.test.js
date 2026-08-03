import { describe, it, expect, vi } from 'vitest';
import { buildHeartbeat, postHeartbeat, idlePanel, openPanel, pendingOpenCommands } from '../edge.js';
import { DEMO_COMMUNITY_ID, GATES } from '../config.js';

const gate = GATES[0];

describe('buildHeartbeat', () => {
  it('is scoped to the demo community and the given gate', () => {
    const hb = buildHeartbeat({ gate, startedAt: 0, now: 60000 });
    expect(hb.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(hb.gate_id).toBe(gate.id);
  });

  it('reports a closed door at rest and an open one while held', () => {
    const rest = buildHeartbeat({ gate, startedAt: 0, now: 1000 });
    expect(rest.is_open).toBe(false);
    expect(rest.panel.door).toBe('closed');
    expect(rest.panel.relay).toBe('off');

    const held = buildHeartbeat({ gate, startedAt: 0, now: 1000, isOpen: true });
    expect(held.is_open).toBe(true);
    expect(held.panel.door).toBe('open');
    expect(held.panel.relay).toBe('on');
  });

  it('reports uptime in whole seconds, never negative', () => {
    expect(buildHeartbeat({ gate, startedAt: 0, now: 90_000 }).uptime_s).toBe(90);
    expect(buildHeartbeat({ gate, startedAt: 90_000, now: 0 }).uptime_s).toBe(0);
  });

  it('satisfies the fields the heartbeat schema requires', () => {
    const hb = buildHeartbeat({ gate, startedAt: 0, now: 1000 });
    for (const k of ['gate_id', 'community_id', 'status', 'is_open', 'queue_depth', 'uptime_s', 'ts']) {
      expect(hb[k], `missing ${k}`).toBeDefined();
    }
    expect(['online', 'offline', 'degraded']).toContain(hb.status);
    expect(Number.isInteger(hb.queue_depth)).toBe(true);
    expect(Number.isInteger(hb.ts)).toBe(true);
  });

  it('can report a buffered backlog, which is the offline-resilience story', () => {
    expect(buildHeartbeat({ gate, startedAt: 0, now: 1000, queueDepth: 17 }).queue_depth).toBe(17);
  });
});

describe('postHeartbeat', () => {
  it('posts to /heartbeat with the device header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await postHeartbeat({ gate_id: gate.id }, { apiBase: 'http://api/api/v1', token: 'tok', fetchImpl });
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/api/v1/heartbeat');
    expect(options.headers['X-Device-Token']).toBe('tok');
  });

  it('reports failure without throwing, so a beat cannot kill the loop', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const res = await postHeartbeat({}, { apiBase: 'http://api/api/v1', token: 't', fetchImpl });
    expect(res.ok).toBe(false);
  });
});

describe('pendingOpenCommands', () => {
  it('asks only for this community\'s manual open commands after a cutoff', async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'e1', gate_id: gate.id }] }) };
    const since = new Date('2026-08-03T10:00:00Z');
    const rows = await pendingOpenCommands(client, since);

    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toMatch(/detection_method = 'manual'/);
    expect(sql).toMatch(/raw_value IN/);
    expect(params[0]).toBe(DEMO_COMMUNITY_ID);
    expect(params[1]).toBe(since);
    expect(rows).toHaveLength(1);
  });
});

describe('panel shapes', () => {
  it('are plain serialisable objects', () => {
    expect(JSON.parse(JSON.stringify(idlePanel()))).toEqual(idlePanel());
    expect(openPanel().door).toBe('open');
  });
});
