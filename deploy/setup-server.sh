#!/bin/bash
set -e

cd /opt/communitygate

# Start infrastructure (PG, Redis, Mosquitto)
docker-compose -f docker-compose.prod.yml up -d

# Wait for PG to be ready
echo "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  docker exec $(docker ps -q -f name=postgres) pg_isready -U cguser 2>/dev/null && break
  sleep 2
done
echo "PostgreSQL ready"

# Run migrations
echo "Running migrations..."
for f in services/api-gateway/migrations/*.sql; do
  echo "  Applying $f..."
  docker exec -i $(docker ps -q -f name=postgres) psql -U cguser -d communitygate < "$f" 2>&1 || true
done
echo "Migrations complete"

# Install API gateway deps
echo "Installing API gateway dependencies..."
cd /opt/communitygate/services/api-gateway
pnpm install --prod 2>&1

# Install admin portal deps and build
echo "Installing admin portal dependencies..."
cd /opt/communitygate/apps/admin-portal
pnpm install 2>&1
echo "Building admin portal..."
NEXT_PUBLIC_API_URL=http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):3000/api/v1 pnpm build 2>&1

cd /opt/communitygate

# Create systemd service for API gateway
sudo tee /etc/systemd/system/communitygate-api.service > /dev/null <<EOF
[Unit]
Description=CommunityGate API Gateway
After=docker.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/communitygate/services/api-gateway
Environment=NODE_ENV=development
Environment=PORT_API_GATEWAY=3000
Environment=JWT_SECRET=communitygate-test-secret-key-2026
Environment=DATABASE_URL=postgresql://cguser:devpass@localhost:5432/communitygate
Environment=REDIS_URL=redis://localhost:6379
Environment=MQTT_BROKER=localhost
Environment=MQTT_PORT=1883
Environment=CORS_ORIGINS=*
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for Admin Portal
sudo tee /etc/systemd/system/communitygate-admin.service > /dev/null <<EOF
[Unit]
Description=CommunityGate Admin Portal
After=communitygate-api.service

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/communitygate/apps/admin-portal
Environment=PORT=3100
ExecStart=/usr/bin/npx next start -p 3100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable communitygate-api communitygate-admin
sudo systemctl start communitygate-api
sleep 3
sudo systemctl start communitygate-admin

echo ""
echo "=== CommunityGate Test App Deployed ==="
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4)
echo "API Gateway:  http://$PUBLIC_IP:3000"
echo "Admin Portal: http://$PUBLIC_IP:3100"
echo "Health check: http://$PUBLIC_IP:3000/health"
echo ""
