# AGENTS.md

This workspace contains **two mostly independent projects**. Its README.md only describes Higgsfield Local; it does *not* describe the game Apex Velocity in `src/`. Check which one your task involves before doing anything.

---

## 1. Apex Velocity — 3D racing game (active project)
- Entrypoints: `start.cmd` (double‑click) or `node serve.mjs [port]`, then open `http://localhost:5173/`.
- No build step, no `npm install`. Static module app. `index.html` → `src/main.js` (imports `three` via import map CDN).
- Gamepad/keyboard input is in `src/core/input.js`; write/side effects go through `window.__game` (`main.js`).
- Verification / dev harnesses are URL params, not test scripts:
  - physics+AI harness: `?selftest=1`
  - race lifecycle: `?racetest=1`
  - visual check (no window): `?shot=<sec>&name=<label>&w=1280&h=760` (POST to `/__shot`; image lands in `shots/<name>.jpg`)
  - performance: `?perf=<frames>`, `?perfparts=1`, `?perftest=1`
- Static checks: `node tools/check.mjs`, `node tools/validateTrack.mjs` (tracks must stay valid).
- The auto‑quality governor used to downgrade resolution; it is disabled and `qualityName` is forced to `high` in `src/main.js` intentionally. Don’t “re-enable auto” unless the user asks.
- Steering/control sign fix: keyboard + gamepad steer are `left = positive` in `src/core/input.js`; do not flip again. Counter‑steer assist has a slip dead zone in `src/car/vehicle.js`.

## 2. Higgsfield Local — local AI image/video platform
- Its docs/README/Makefile/docker-compose refer to *this* part of the folder (`backend/`, `frontend/`, `models/`, `scripts/`), not the game.
- Backend: FastAPI (`backend/main.py`), Python 3.10+, `pip install -r backend/requirements.txt`, run `python backend/main.py` (or `make dev`). Tests/lint via `make test` / `make lint`.
- Frontend: `frontend/`; dev serve: `cd frontend && python -m http.server 8080` (or `make frontend`).
- Docker: `docker-compose up -d`, Web UI on `:7860`. Env template `.env.example`.
- Models registry: `models/registry.json`; download/benchmark helpers in `models/`.

### Gotchas
- `README.md` and `Makefile` belong to Higgsfield Local and will mislead you about the game. Trust the code, `src/main.js` header, `index.html` title, and `start.cmd` for Apex Velocity.
- Serve the game with `node serve.mjs` (not `python -m http.server`); the game relies on `POST /__shot` for screenshot capture.
- Automated regression: a repeatable QA agent lives at `.opencode/agents/qa-tester.md` (runs `check.mjs`, `validateTrack.mjs`, and the URL-param harnesses); invoke it after updates instead of hand-testing every change.
