import mqtt from 'mqtt';
import { v4 as uuidv4 } from 'uuid';

const MQTT_BROKER = process.env.MQTT_BROKER || '';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883');
const MQTT_COMMAND_TTL_SECONDS = parseInt(process.env.MQTT_COMMAND_TTL_SECONDS || '30');

let client = null;
let mockMode = false;

/**
 * Connect to the MQTT broker. Falls back to mock mode if broker is not
 * configured or connection fails.
 */
export function connect() {
  if (!MQTT_BROKER) {
    console.log('[mqtt] No MQTT_BROKER set — running in mock mode');
    mockMode = true;
    return;
  }

  try {
    client = mqtt.connect(`mqtt://${MQTT_BROKER}:${MQTT_PORT}`, {
      reconnectPeriod: 5000,
      connectTimeout: 10000,
    });

    client.on('connect', () => {
      console.log(`[mqtt] Connected to ${MQTT_BROKER}:${MQTT_PORT}`);
      // Subscribe to ACK topics
      client.subscribe('cg/+/gates/+/ack', { qos: 1 }, (err) => {
        if (err) console.error('[mqtt] ACK subscribe error', err);
        else console.log('[mqtt] Subscribed to cg/+/gates/+/ack');
      });
    });

    client.on('message', (topic, message) => {
      try {
        const ack = JSON.parse(message.toString());
        console.log(`[mqtt] ACK received on ${topic}:`, ack);
      } catch {
        console.log(`[mqtt] ACK received on ${topic}: (non-JSON)`, message.toString());
      }
    });

    client.on('error', (err) => {
      console.error('[mqtt] Connection error — falling back to mock mode', err.message);
      mockMode = true;
    });
  } catch (err) {
    console.error('[mqtt] Failed to connect — running in mock mode', err.message);
    mockMode = true;
  }
}

/**
 * Build a command payload and publish to the MQTT topic for the given gate.
 *
 * @param {string} communityId
 * @param {string} gateId
 * @param {object} opts – { action, plate, rfid_hash, method, unit_id, unit_number, resident_name }
 * @returns {object} The published payload (including generated event_id and timestamps)
 */
export function publishCommand(communityId, gateId, opts = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    action: opts.action || 'open',
    event_id: uuidv4(),
    plate: opts.plate || null,
    rfid_hash: opts.rfid_hash || null,
    method: opts.method || 'manual',
    unit_id: opts.unit_id || null,
    unit_number: opts.unit_number || null,
    resident_name: opts.resident_name || null,
    ttl: now + MQTT_COMMAND_TTL_SECONDS,
    issued_at: now,
  };

  const topic = `cg/${communityId}/gates/${gateId}/commands`;

  if (mockMode || !client || !client.connected) {
    console.log(`[mqtt-mock] PUBLISH ${topic}`, JSON.stringify(payload));
    return payload;
  }

  client.publish(topic, JSON.stringify(payload), { qos: 1, retain: false }, (err) => {
    if (err) console.error(`[mqtt] Publish error on ${topic}`, err);
    else console.log(`[mqtt] Published to ${topic}`, payload.event_id);
  });

  return payload;
}

/**
 * Disconnect the MQTT client cleanly.
 */
export function disconnect() {
  if (client) {
    client.end();
    client = null;
  }
}

export { mockMode };
