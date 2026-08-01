import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { deviceToken, postEvent } from '../generate.js';
import { DEMO_COMMUNITY_ID, GATES } from '../config.js';

describe('deviceToken', () => {
  it('mints a token the device middleware will accept', () => {
    const token = deviceToken(GATES[0].id, 'test-secret');
    const decoded = jwt.verify(token, 'test-secret');
    expect(decoded.community_id).toBe(DEMO_COMMUNITY_ID);
    expect(decoded.gate_id).toBe(GATES[0].id);
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('will not verify under a different secret', () => {
    const token = deviceToken(GATES[0].id, 'test-secret');
    expect(() => jwt.verify(token, 'wrong-secret')).toThrow();
  });
});

describe('postEvent', () => {
  it('posts a single-event batch with the device header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const payload = { community_id: DEMO_COMMUNITY_ID, gate_id: GATES[0].id };

    const result = await postEvent(payload, {
      apiBase: 'http://api/api/v1', token: 'tok', fetchImpl,
    });

    expect(result.ok).toBe(true);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://api/api/v1/events/sync');
    expect(options.headers['X-Device-Token']).toBe('tok');
    expect(JSON.parse(options.body)).toEqual({ events: [payload] });
  });

  it('reports failure without throwing, so one bad post cannot kill the loop', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await postEvent({}, { apiBase: 'http://api/api/v1', token: 't', fetchImpl });
    expect(result.ok).toBe(false);
  });
});
