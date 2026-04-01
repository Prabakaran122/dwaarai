# CommunityGate Phase 1 — Foundation + Edge Design

## Summary

Phase 1 implements Steps 1-8 from the CommunityGate spec: repo scaffold, database migrations, edge hardware emulators, edge config, offline queue, whitelist sync, ANPR service, and the gate controller. The result is a working gate system that opens for registered vehicles using emulated hardware, with offline resilience via SQLite caching.

## Architecture

- **Monorepo** with pnpm workspaces, ESM throughout Node.js
- **Edge firmware** in Python — runs on Raspberry Pi or Docker ARM64 emulation
- **ANPR service** as Python FastAPI microservice with EasyOCR
- **Hardware abstraction** via mock flags at import time — same code runs on real Pi and dev machines
- **Offline-first** — SQLite whitelist cache + event queue on edge; sync to cloud when online

## Scope

| Step | What | Key Files |
|------|------|-----------|
| 1 | Repo scaffold | package.json, pnpm-workspace.yaml, .env.example, docker-compose.dev.yml |
| 2 | DB migrations | migrations/001_core.sql through 005_seed.sql |
| 3 | Edge emulators | edge/emulators/gpio_mock.py, rfid_mock.py, camera_mock.py |
| 4 | Edge config | edge/config.py, edge/requirements.txt |
| 5 | Offline queue | edge/offline_queue.py |
| 6 | Whitelist sync | edge/whitelist_sync.py |
| 7 | ANPR service | services/anpr-service/main.py, normalizer.py, Dockerfile |
| 8 | Gate controller | edge/gate_controller.py + integration tests |

## Key Decisions

- All code follows spec exactly — file paths, variable names, table names per spec
- Python 3.11+ (spec says 3.11, local is 3.13 — compatible)
- Tests use pytest with mocked hardware, no AWS needed
- Docker Compose provides Postgres, Redis, Mosquitto for local dev
