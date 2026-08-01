import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { deviceToken, postEvent, loadPopulation, connectDb } from '../generate.js';
import { DEMO_COMMUNITY_ID, GATES } from '../config.js';
import { buildEvent } from '../event.js';

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

describe('connectDb', () => {
  it('handles the client error event instead of letting it kill the process', () => {
    // node-postgres emits 'error' on the Client when the backend connection
    // drops. EventEmitter throws an unhandled 'error' event, and because it is
    // emitted outside any await it becomes an uncaught exception — a Postgres
    // restart would take the always-on generator down with it.
    const onLost = vi.fn();
    const client = connectDb('postgres://u:p@127.0.0.1:5432/db', onLost);
    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => client.emit('error', new Error('terminating connection'))).not.toThrow();
    expect(onLost).toHaveBeenCalledTimes(1);
  });
});

describe('loadPopulation', () => {
  it('reads real ids back out of the database in the shape buildEvent expects', async () => {
    // Important 4: this is the test that would have caught Critical 1 — a fake
    // client returning canned rows in the *real* column-alias shape (including
    // `status`, which an earlier draft of the units query forgot to select).
    const fakeClient = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'unit-1', unitNumber: 'A-101', status: 'occupied' }],
        })
        .mockResolvedValueOnce({
          rows: [
            { id: 'res-1', unitId: 'unit-1', name: 'Rajesh Sharma', type: 'owner', isPrimary: true },
            { id: 'guard-1', unitId: null, name: 'Ram Kishan', type: 'guard', isPrimary: false },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'veh-1', unitId: 'unit-1', residentId: 'res-1', plate: 'HR26AB1234' }],
        }),
    };

    const pop = await loadPopulation(fakeClient);

    expect(pop.units).toEqual([{ id: 'unit-1', unitNumber: 'A-101', status: 'occupied' }]);
    expect(pop.vehicles).toHaveLength(1);
    expect(pop.guards).toHaveLength(1);
    expect(pop.residents).toHaveLength(1);

    // A rand() pinned low always resolves the single-entry lists to their one
    // element and keeps the vehicle "known" (< 0.88), so buildEvent should be
    // able to fully resolve the match chain from ids that actually came from
    // the fake "database" rows above.
    const rand = () => 0.1;
    const event = buildEvent({ pop, gate: GATES[0], at: new Date(), rand });

    expect(event.matched_vehicle_id).toBe('veh-1');
    expect(event.matched_unit_id).toBe('unit-1');
    expect(event.matched_unit_number).toBe('A-101');
    expect(event.resident_name).toBe('Rajesh Sharma');
  });
});
