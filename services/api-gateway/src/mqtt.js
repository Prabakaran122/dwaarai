import mqtt from 'mqtt';

const BROKER_URL = `mqtt://${process.env.MQTT_BROKER || 'localhost'}:${process.env.MQTT_PORT || 1883}`;
let client = null;

export function getMqttClient() {
  if (client) return client;

  client = mqtt.connect(BROKER_URL, {
    clientId: `api-gateway-${process.pid}`,
    clean: true,
    reconnectPeriod: 5000,
  });

  client.on('connect', () => console.log(`MQTT connected to ${BROKER_URL}`));
  client.on('error', (err) => console.error('MQTT error:', err.message));
  client.on('reconnect', () => console.log('MQTT reconnecting...'));

  return client;
}

export function publishGateCommand(communityId, gateId, command) {
  const topic = `cg/${communityId}/gates/${gateId}/commands`;
  const payload = JSON.stringify(command);
  const mqttClient = getMqttClient();

  return new Promise((resolve, reject) => {
    mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
      if (err) {
        console.error(`MQTT publish failed on ${topic}:`, err);
        reject(err);
      } else {
        console.log(`MQTT published to ${topic}: ${command.action}`);
        resolve();
      }
    });
  });
}
