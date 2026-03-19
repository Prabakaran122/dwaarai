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
- [x] Step 9: Notification Service
- [x] Step 10: Audit/Log Service
- [x] Step 11: Edge Node -- Relay and RFID Drivers
- [x] Step 12: Edge Node -- ANPR Camera Pipeline
- [x] Step 13: Edge Node -- Local Decision Engine
- [x] Step 14: Edge Node -- Offline Queue and Whitelist Sync
- [x] Step 15: Guard App (React Native — Android tablet)
- [x] Step 16: Resident App (React Native — iOS + Android)
- [x] Step 17: Admin Portal (Next.js 14)
- [x] Step 18: AWS CDK Infrastructure (6 stacks)
- [x] Step 19: Pi Provisioning Script
- [x] Step 20: CI/CD Pipeline (GitHub Actions)
