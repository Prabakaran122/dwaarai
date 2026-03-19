# CommunityGate

Vehicle access control platform for residential communities. Cloud microservices (Node.js/Express) manage residents, vehicles, visitors, and gate commands. Edge nodes (Raspberry Pi, Python) run ANPR cameras, RFID readers, and relay-controlled gates, syncing with the cloud over MQTT.

**Stack:** Node.js 20+ (ESM), Python 3.11+, PostgreSQL, Redis, MQTT (AWS IoT Core), pnpm monorepo, AWS CDK for infra.

## Build Step Checklist

- [x] Step 1: Initialize Git Repo and Monorepo Scaffold
- [x] Step 2: Docker Compose Dev Environment
- [x] Step 3: PostgreSQL Schema and Migrations
- [x] Step 4: Shared Utilities Package
- [x] Step 5: API Gateway Service
- [x] Step 6: Vehicle Service
- [x] Step 7: Visitor/Pre-Approval Service
- [x] Step 8: Gate Command Service + MQTT
- [ ] Step 9: Notification Service
- [ ] Step 10: Audit/Log Service
- [ ] Step 11: Edge Node -- Relay and RFID Drivers
- [ ] Step 12: Edge Node -- ANPR Camera Pipeline
- [ ] Step 13: Edge Node -- Local Decision Engine
- [ ] Step 14: Edge Node -- Offline Queue and Whitelist Sync
- [ ] Step 15: Admin Dashboard (Next.js)
- [ ] Step 16: Resident Mobile App (React Native stub)
- [ ] Step 17: AWS CDK Infrastructure
- [ ] Step 18: CI/CD Pipeline (GitHub Actions)
- [ ] Step 19: Integration Tests
- [ ] Step 20: Documentation and Final Wiring
