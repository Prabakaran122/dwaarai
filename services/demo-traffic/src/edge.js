import { DEMO_COMMUNITY_ID, GATES } from './config.js';

/**
 * A virtual edge node for the demo tenant.
 *
 * Real gates run a Pi/Windows edge box that heartbeats to POST /heartbeat with
 * its door/relay state, and opens the boom when it receives an MQTT command.
 * The demo tenant has no such hardware, which had two visible consequences:
 * the Edge Health panel was empty (gates.panel was NULL, telemetry_at never),
 * and pressing "Open" recorded "opened by superadmin" while the door state
 * never changed, because nothing was listening to actuate or report back.
 *
 * This impersonates that box over HTTP. It does NOT subscribe to MQTT: the
 * cloud already records every manual command as a gate_events row
 * (detection_method='manual', raw_value='open'), so watching the database is
 * both simpler and immune to broker configuration. The observable behaviour on
 * the dashboard is identical.
 */

const OPEN_HOLD_MS = 6000; // how long the boom stays up before it closes again

/** The panel telemetry a C3 controller reports at rest. */
export function idlePanel() {
  return { door: 'closed', relay: 'off', alarm: false, tamper: false };
}

/** The panel telemetry while the boom is up. */
export function openPanel() {
  return { door: 'open', relay: 'on', alarm: false, tamper: false };
}

/**
 * Build a heartbeat body for one gate.
 *
 * `queueDepth` is what makes the offline-resilience story visible: a real edge
 * buffers events while the uplink is down, and the dashboard surfaces that
 * backlog. Kept at 0 unless a caller is deliberately demonstrating it.
 */
export function buildHeartbeat({ gate, startedAt, now, isOpen = false, queueDepth = 0 }) {
  return {
    gate_id: gate.id,
    community_id: DEMO_COMMUNITY_ID,
    status: 'online',
    is_open: isOpen,
    queue_depth: queueDepth,
    uptime_s: Math.max(0, Math.floor((now - startedAt) / 1000)),
    ts: Math.floor(now / 1000),
    panel: isOpen ? openPanel() : idlePanel(),
  };
}

export async function postHeartbeat(body, { apiBase, token, fetchImpl = fetch }) {
  try {
    const res = await fetchImpl(`${apiBase}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': token },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    // Never throw: a heartbeat failure must not take the generator down.
    return { ok: false, status: 0, message: err.message };
  }
}

/**
 * Manual open commands recorded since `since`, newest first.
 *
 * The cloud writes these rows itself in POST /gates/:id/command before
 * publishing to MQTT, so they are a faithful record of what an operator asked
 * for, whether or not a broker was reachable.
 */
export async function pendingOpenCommands(client, since) {
  const { rows } = await client.query(
    `SELECT id, gate_id, event_ts
       FROM gate_events
      WHERE community_id = $1
        AND detection_method = 'manual'
        AND raw_value IN ('open', 'open_once', 'unlock')
        AND event_ts > $2
      ORDER BY event_ts DESC
      LIMIT 20`,
    [DEMO_COMMUNITY_ID, since]
  );
  return rows;
}

export { OPEN_HOLD_MS };
export const ALL_GATES = GATES;
