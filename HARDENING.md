# PMOVES-OpenRoom Fork — Hardening Notes

**Status:** 2026-07-24 first slice (openroom-adapter lane, Mavis::OPENROOM-ADAPTER-LANE-CLAIM)
**Fork of:** `MiniMax-AI/OpenRoom` (upstream, MIT)
**Branch convention:** tracks `PMOVES.AI-Edition-Hardened` in the parent
monorepo's `.gitmodules`. Local development branches (e.g.
`feat/pmoves-room-adapter`) are squashed onto the hardened branch before
fork-sync promotions land on the upstream PR.

## What this fork adds

- `apps/webuiapps/src/lib/pmovesRoomAdapter.ts` — manifest → window/app
  composition, P7 session binding, stage discipline (rehearsal/live/review/
  archive). Reads `?room=<id>` from the URL.
- `apps/webuiapps/src/lib/appRegistry.ts` — runtime `registerApp()` +
  `getAppByRoute()` + `clearPmovesApps()`. PMOVES apps take appIds 1000+
  to avoid collision with the static 1-14 range.
- `apps/webuiapps/src/lib/windowManager.ts` — `openWindowAt()` for explicit
  initial placement from `shell.layout.panels[]` + `closeAllPmovesWindows()`
  for room-exit cleanup.
- `apps/webuiapps/src/pages/StubApp/index.tsx` — fallback renderer for
  PMOVES-range apps until the real app adapters are wired (per the
  openroom-adapter follow-up lane).
- `apps/webuiapps/src/components/AppWindow/index.tsx` — render StubApp
  when `win.appId >= PMOVES_DYNAMIC_APP_ID_BASE`.
- `apps/webuiapps/src/components/Shell/index.tsx` — new useEffect on
  mount calls `loadPmovesRoomIfPresent()` and disposes on unmount.
- `apps/webuiapps/nginx/default.conf` — two new upstream routes:
  - `location ~ ^/api/rooms/([a-z0-9._-]+)\.json$` — serves PMOVES room
    manifests read-only from the volume-mounted `/etc/pmoves/rooms/`.
    The regex match denies path traversal.
  - `location /api/p7/` — proxy to `p7-room-orchestrator:8120` with
    forwarded `Authorization` header for `P7_CONTROL_TOKEN`.

## How the parent monorepo wires it

`pmoves/docker-compose.yml` (or `pmoves/docker-compose.agents.yml` in the
PMOVES-AI-Edition-Hardened branch) brings the OpenRoom container up under
the `p7` profile with these mounts:

```yaml
  openroom:
    build:
      context: .
      dockerfile: PMOVES-OpenRoom/apps/webuiapps/Dockerfile
    image: pmoves/openroom:latest
    container_name: pmoves-openroom
    profiles: ["p7"]
    restart: unless-stopped
    environment:
      - P7_HOST=0.0.0.0  # if a separate P7_HOST is used by the build
    volumes:
      # Read-only PMOVES room manifests — the adapter fetches these.
      - ./pmoves/config/rooms:/etc/pmoves/rooms:ro
      # Optionally: shared env file for OPENROOM_BASE_URL override.
      - ./pmoves/env.shared:/etc/pmoves/env.shared:ro
    ports:
      - "5173:5173"   # Vite dev (local) — production runs on 3000
    depends_on:
      p7-room-orchestrator:
        condition: service_healthy
```

For local development (no docker), `pnpm dev` in `PMOVES-OpenRoom/` runs
Vite on `:5173` with HMR. The adapter's `/api/rooms/<id>.json` and
`/api/p7/*` fetches resolve against the Vite dev server, so the
same-origin dev URL works without the nginx reverse proxy — see
`vite.config.ts` proxy section.

## Fork conventions honored

- `.gitmodules` `ignore = all` — the parent monorepo doesn't index the
  fork's working tree (only the gitlink). The fork's own repo handles
  diffs and PRs upstream.
- Submodule branch tracks `PMOVES.AI-Edition-Hardened` per the fleet
  convention. Local feature branches land via PR into that branch.
- All public endpoints documented at the route level.
- No external CDN at runtime (the upstream `STATIC_WALLPAPER` and
  `VIDEO_WALLPAPER` constants in `Shell/index.tsx` reference
  `cdn.openroom.ai` — keep as a fallback, but PMOVES shells override
  via the manifest's `shell.theme`).

## CSP and security

- All Shell-internal click handlers stay in the same CSP-safe spirit as
  the rest of the desktop (no inline scripts in baked surfaces).
- Bearer auth on `/api/p7/rooms/{id}/session` is forwarded by nginx and
  verified server-side by the P7 orchestrator's `require_http_control`.
  No token in the OpenRoom container itself.
- `/api/rooms/<id>.json` regex match enforces `[a-z0-9._-]+` so
  `/api/rooms/../etc/passwd.json` cannot escape the manifest dir.
- `pmovesRoomAdapter.ts` logs P7 publish failures but never includes
  secrets in error messages (only subject + status).

## Stage discipline

The adapter reads `manifest.stage` and applies the four canonical
PMOVES room stages (per `pmoves/docs/ROOMS_ON_A_STAGE.md`):

- `rehearsal` — StubApp shows "PREVIEW — not connected to live
  services" banner. App interactions are disabled.
- `live` — StubApp shows "LIVE" banner. Real app adapters (when wired)
  will route to the underlying services.
- `review` — StubApp shows "READ-ONLY" banner. App interactions are
  read-only.
- `archive` — StubApp shows "ARCHIVED" banner. Apps are not opened;
  only the desktop wallpaper reflects the room's theme.

The `data-pmoves-stage` attribute is set on `<html>` so CSS can layer
the stage discipline at the document level (e.g. dim the wallpaper in
`archive`).

## Out of scope (deferred to follow-up lane entries)

- Implementing the 11 OpenRoom sample apps (Twitter, Music, Diary, etc.)
  under PMOVES namespace — they remain stock OpenRoom.
- Wiring OpenRoom's `llmClient.ts` to PMOVES model nexus.
- Notebook pane → OpenRoom `vibeContainer` integration.
- Per-room persona theming beyond accent color.
- Cross-room session handoff (P7 close→open transition).
- Real adapters for each `apps[].route` (currently StubApp).

## Tests

The OpenRoom fork's own test suite is at
`apps/webuiapps/e2e/` and `apps/webuiapps/src/lib/__tests__/` (Playwright
+ Vitest). The PMOVES adapter is covered by:

- Vitest unit tests for the new `registerApp` /
  `openWindowAt` / `closeAllPmovesWindows` API surface.
- P7 round-trip integration tested in
  `pmoves/services/p7-room-orchestrator/tests/test_app.py`
  (`test_openroom_session_endpoint_open_close_round_trip`).
- A2UI bridge tests for `p7.nats.session` event handling — already
  covered in `pmoves/services/a2ui-nats-bridge/tests/test_signature_gate.py`.

E2E shell composition is a Playwright run (slice 5) — see
`pmoves/docs/evidence/openroom-adapter-2026-07-24/`.
