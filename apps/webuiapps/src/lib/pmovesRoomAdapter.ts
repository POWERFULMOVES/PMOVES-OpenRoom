/**
 * PMOVES Room Adapter (openroom-adapter lane, 2026-07-24)
 * =========================================================
 *
 * Reads `?room=<id>` from the URL, fetches the corresponding room manifest
 * from `/api/rooms/<id>.json`, and composes the OpenRoom desktop from the
 * manifest's `shell.layout.panels[]` + `apps[]`.
 *
 * Wiring:
 *   1. /stage/ card Enter button navigates to `${OPENROOM_BASE_URL}/?room=<id>`
 *   2. OpenRoom boot URL has `?room=<id>` in the query string
 *   3. Shell's mount useEffect calls `loadPmovesRoomIfPresent()`
 *   4. Adapter fetches manifest, registers apps, opens windows, calls P7 session
 *   5. On unmount, calls P7 session close + clears state
 *
 * Stage discipline (per pmoves/docs/ROOMS_ON_A_STAGE.md):
 *   - rehearsal: persistent "PREVIEW" banner, all PMOVES app interactions
 *     suppressed (window contents show manifest metadata instead of routing
 *     to live services). Apps are still openable for inspection.
 *   - live: full interactivity, all apps route normally.
 *   - review: read-only — apps open but show "REVIEW" banner.
 *   - archive: apps registered but not opened; only the desktop wallpaper
 *     reflects the room's theme.
 *
 * P7 session binding:
 *   - On room enter: POST /api/p7/rooms/{id}/session with {action: "open",
 *     agent_id: window.PMOVES_AGENT_ID || "anonymous", alter: window.PMOVES_ALTER || ""}
 *   - On room leave: same with {action: "close"}
 *   - If the P7 endpoint is unreachable, log a warning and continue (the
 *     adapter is best-effort; P7 session failure doesn't block the desktop).
 *
 * See also:
 *   - pmoves/docs/AGENTS/AGNOTE4482PHI.t1.md (Mavis::OPENROOM-ADAPTER-LANE-CLAIM)
 *   - pmoves/services/p7-room-orchestrator/ (PR #2173, the P7 control plane)
 *   - website/stage/stage.js (the /stage/ card "Enter" handler)
 */

import {
  registerApp,
  clearPmovesApps,
  getAppByRoute,
  PMOVES_DYNAMIC_APP_ID_BASE,
} from './appRegistry';
import {
  openWindowAt,
  closeAllPmovesWindows,
} from './windowManager';
import type { WindowState } from './windowManager';

// ---- types matching the PMOVES room manifest v1 schema ----

export type RoomStage = 'rehearsal' | 'live' | 'review' | 'archive';

export interface RoomManifest {
  room_id: string;
  version?: string;
  stage: RoomStage;
  display_name: string;
  description?: string;
  agent_id?: string;
  alter?: string;
  room_type?: string;
  access?: {
    visibility?: 'public' | 'unlisted' | 'private';
    owner_only?: boolean;
    exclude_from_public_catalog?: boolean;
  };
  shell?: {
    theme?: {
      theme_id?: string;
      accent_color?: string;
      skin?: string;
      icon?: string;
      // P6 (openroom-realization slice 2): optional wallpaper URL — sets
      // --pm-wallpaper on document root. AppWindow + Shell can consume
      // it via var(--pm-wallpaper). If unset, the openroom default
      // wallpaper applies.
      wallpaper?: string;
    };
    layout?: {
      default_route?: string;
      panels?: RoomPanel[];
    };
  };
  apps?: RoomApp[];
  notebook?: {
    provider?: string;
    workspace_ref?: string;
    thread_ref?: string;
  };
  persona?: {
    glyph?: string;
    theme_id?: string;
  };
}

export interface RoomPanel {
  panel_id: string;
  kind: 'chat' | 'browser' | 'custom' | 'notebook' | 'graph' | 'media' | 'controls' | 'tasks' | 'logs';
  position?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  size?: number; // 0-100 percent of the parent axis
  pinned?: boolean;
  route?: string; // optional explicit route override
}

export interface RoomApp {
  app_id: string;
  kind: string;
  route: string;
  provider?: string;
  action_namespace?: string;
  capabilities?: string[];
  pinned?: boolean;
  status?: 'active' | 'planned' | 'disabled';
}

export interface LoadedRoom {
  manifest: RoomManifest;
  /** appId assigned by registerApp for each manifest app (keyed by app_id). */
  appIdByAppId: Record<string, number>;
  /** WindowState for each panel opened during composition. */
  windowIds: number[];
  /** Disposer to call on room exit. */
  dispose: () => Promise<void>;
}

// ---- public API ----

/**
 * Read `?room=<id>` from the current URL. Returns the room id, or null if
 * not present.
 */
export function getRoomIdFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('room');
    if (!id) return null;
    // Defensive: room_id may contain `.` (e.g. demo.room.rehearsal) but no
    // slashes, query params, or fragments. Reject anything weird.
    if (!/^[a-z0-9._-]+$/i.test(id)) {
      console.warn('[pmoves-room] invalid room id in URL; ignoring:', id);
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * If `?room=<id>` is present, fetch + compose + bind P7. Returns the loaded
 * room (or null if no room in URL). Caller is responsible for calling
 * `dispose()` on unmount.
 */
export async function loadPmovesRoomIfPresent(): Promise<LoadedRoom | null> {
  const roomId = getRoomIdFromUrl();
  if (!roomId) return null;
  return await loadPmovesRoom(roomId);
}

/**
 * Load and compose a PMOVES room by id. Used by both the URL-driven mount
 * path and any programmatic entry (e.g. a future "switch room" affordance).
 */
export async function loadPmovesRoom(roomId: string): Promise<LoadedRoom> {
  console.log('[pmoves-room] loading', roomId);
  const manifest = await fetchManifest(roomId);

  // Register each app in the manifest. We allocate a single appId per
  // manifest app; the sourceDir is left undefined because PMOVES apps are
  // served as stubs (the StubApp component shows manifest metadata) until
  // each is properly wired.
  const appIdByAppId: Record<string, number> = {};
  for (const app of manifest.apps || []) {
    const id = registerApp({
      appName: app.app_id,
      route: app.route,
      displayName: appDisplayName(app),
      icon: appIconForKind(app.kind),
      color: appColorForKind(app.kind),
      defaultSize: defaultSizeForKind(app.kind),
    });
    appIdByAppId[app.app_id] = id;
  }

  // Compose the desktop from shell.layout.panels[]. If no panels declared,
  // fall back to opening one window per pinned app.
  const windowIds: number[] = [];
  // Archive-stage rooms: register apps but don't open any windows (per the
  // stage-discipline contract in pmoves/docs/ROOMS_ON_A_STAGE.md; chatgpt-
  // codex P2). The theme + data-pmoves-* attrs still get set so the
  // desktop wallpaper + StubApp banner reflect the archived state.
  const isArchived = manifest.stage === 'archive';
  const panels = manifest.shell?.layout?.panels || [];
  if (!isArchived && panels.length > 0) {
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const win = composePanel(panel, manifest, appIdByAppId, i);
      if (win !== null) windowIds.push(win);
    }
  } else if (!isArchived) {
    // No panels: one window per pinned app, stacked top-left.
    const pinnedApps = (manifest.apps || []).filter((a) => a.pinned !== false);
    for (let i = 0; i < pinnedApps.length; i++) {
      const app = pinnedApps[i];
      const appId = appIdByAppId[app.app_id];
      if (appId === undefined) continue;
      const offset = i * 30;
      openWindowAt(appId, 80 + offset, 40 + offset, 600, 400);
      windowIds.push(appId);
    }
  }

  // Apply shell theme via CSS custom properties on document root.
  applyTheme(manifest);

  // P7 session bind (best-effort).
  const p7Result = await p7Session(manifest, 'open');

  return {
    manifest,
    appIdByAppId,
    windowIds,
    dispose: async () => {
      closeAllPmovesWindows(PMOVES_DYNAMIC_APP_ID_BASE);
      clearPmovesApps();
      await p7Session(manifest, 'close');
      // Remove theme overrides we added.
      removeTheme(manifest);
      console.log('[pmoves-room] disposed', roomId);
    },
  };
}

// ---- internal helpers ----

async function fetchManifest(roomId: string): Promise<RoomManifest> {
  // The manifest is served by the OpenRoom nginx config (see HARDENING.md)
  // from pmoves/config/rooms/<roomId>.json. Falls back to a same-origin
  // /api/rooms/<id>.json if the operator mounts the dir there.
  const url = `/api/rooms/${roomId}.json`;
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(
      `[pmoves-room] manifest fetch failed: ${res.status} ${res.statusText} for ${url}`,
    );
  }
  const manifest = (await res.json()) as RoomManifest;
  if (manifest.room_id !== roomId) {
    throw new Error(
      `[pmoves-room] manifest room_id mismatch: url=${roomId} file=${manifest.room_id}`,
    );
  }
  return manifest;
}

function composePanel(
  panel: RoomPanel,
  manifest: RoomManifest,
  appIdByAppId: Record<string, number>,
  index: number,
): number | null {
  // Resolve a route for the panel: explicit panel.route > first app whose
  // app_id contains the panel.panel_id (case-insensitive) > panel_id.
  const route = resolvePanelRoute(panel, manifest);
  if (!route) {
    console.warn('[pmoves-room] no route for panel', panel.panel_id);
    return null;
  }
  // Resolve to a registered app: either the panel.route maps to a manifest
  // app we registered, or we need to register a stub on the fly.
  let appId = getAppByRoute(route)?.appId;
  if (appId === undefined) {
    appId = registerApp({
      appName: panel.panel_id,
      route,
      displayName: panelDisplayName(panel),
      icon: appIconForKind(panel.kind),
      color: appColorForKind(panel.kind),
      defaultSize: defaultSizeForKind(panel.kind),
    });
  }
  // Position: derive x/y from panel.position + size (0-100 of viewport).
  const { x, y, width, height } = panelPosition(panel, index);
  openWindowAt(appId, x, y, width, height);
  return appId;
}

function resolvePanelRoute(panel: RoomPanel, manifest: RoomManifest): string | null {
  if (panel.route) return panel.route;
  // First app whose app_id contains panel.panel_id.
  const apps = manifest.apps || [];
  const hit = apps.find(
    (a) =>
      a.app_id.toLowerCase().includes(panel.panel_id.toLowerCase()) ||
      panel.panel_id.toLowerCase().includes(a.app_id.toLowerCase()),
  );
  if (hit) return hit.route;
  return `/${panel.panel_id}`;
}

function panelPosition(
  panel: RoomPanel,
  index: number,
): { x: number; y: number; width: number; height: number } {
  // Reasonable defaults for a 1440x900 viewport; windowManager clamps
  // width/height to 300/200 minimum.
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1440;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  const size = Math.max(20, Math.min(80, panel.size ?? 40));
  const offset = (index % 5) * 24;
  switch (panel.position) {
    case 'left':
      return {
        x: 8,
        y: 8 + offset,
        width: Math.round((viewportW * size) / 100),
        height: viewportH - 80,
      };
    case 'right':
      return {
        x: viewportW - Math.round((viewportW * size) / 100) - 8,
        y: 8 + offset,
        width: Math.round((viewportW * size) / 100),
        height: viewportH - 80,
      };
    case 'top':
      return {
        x: 8 + offset,
        y: 8,
        width: viewportW - 40,
        height: Math.round((viewportH * size) / 100),
      };
    case 'bottom':
      return {
        x: 8 + offset,
        y: viewportH - Math.round((viewportH * size) / 100) - 40,
        width: viewportW - 40,
        height: Math.round((viewportH * size) / 100),
      };
    case 'center':
    default:
      return {
        x: 8 + offset,
        y: 8 + offset,
        width: Math.round((viewportW * size) / 100),
        height: Math.round((viewportH * size) / 100),
      };
  }
}

function applyTheme(manifest: RoomManifest): void {
  const theme = manifest.shell?.theme;
  // Apply stage + room id attrs unconditionally so the StubApp banner
  // and document-level CSS can see the right stage even when the
  // manifest omits the optional theme fields (chatgpt-codex P2).
  document.documentElement.setAttribute('data-pmoves-room', manifest.room_id);
  document.documentElement.setAttribute('data-pmoves-stage', manifest.stage);
  // P6 (openroom-realization slice 2): consume theme.skin, theme.icon,
  // and theme.wallpaper for the room's visual identity. Each is set as
  // both a data-attr (for CSS selectors like [data-pmoves-skin="..."])
  // and a CSS custom property (for var() in component stylesheets).
  // The accent_color remains the canonical room-color; skin/icon are
  // additive (don't override the accent). The wallpaper, if set, takes
  // precedence over the openroom default wallpaper for the duration of
  // the session.
  if (theme?.skin) {
    document.documentElement.setAttribute('data-pmoves-skin', theme.skin);
    document.documentElement.style.setProperty('--pm-skin', theme.skin);
  }
  if (theme?.icon) {
    document.documentElement.setAttribute('data-pmoves-icon', theme.icon);
    document.documentElement.style.setProperty('--pm-icon', theme.icon);
  }
  if (theme?.accent_color) {
    document.documentElement.style.setProperty('--pm-accent', theme.accent_color);
  }
  // P6 optional extension: theme.wallpaper (declared in shell.theme;
  // the manifest schema is the source of truth). Forward-declared here
  // so the openroom skin authors can ship wallpaper variants without
  // adapter changes.
  const themeAny = theme as { wallpaper?: string } | undefined;
  if (themeAny?.wallpaper) {
    document.documentElement.style.setProperty('--pm-wallpaper', themeAny.wallpaper);
  }
}

function removeTheme(manifest: RoomManifest): void {
  document.documentElement.style.removeProperty('--pm-accent');
  document.documentElement.style.removeProperty('--pm-skin');
  document.documentElement.style.removeProperty('--pm-icon');
  document.documentElement.style.removeProperty('--pm-wallpaper');
  document.documentElement.removeAttribute('data-pmoves-room');
  document.documentElement.removeAttribute('data-pmoves-stage');
  document.documentElement.removeAttribute('data-pmoves-skin');
  document.documentElement.removeAttribute('data-pmoves-icon');
}

async function p7Session(
  manifest: RoomManifest,
  action: 'open' | 'close',
): Promise<{ ok: boolean; status: number; detail?: string }> {
  // The P7 control plane lives at /api/p7 (proxied by OpenRoom nginx to the
  // p7-room-orchestrator service on port 8120, see HARDENING.md). Best-effort:
  // network errors are logged but don't block the desktop.
  const url = `/api/p7/rooms/${encodeURIComponent(manifest.room_id)}/session`;
  const body = {
    action,
    agent_id: (typeof window !== 'undefined' && window.PMOVES_AGENT_ID) || 'anonymous',
    alter: (typeof window !== 'undefined' && window.PMOVES_ALTER) || '',
    room_stage: manifest.stage,
    timestamp: new Date().toISOString(),
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
    if (!res.ok) {
      console.warn('[pmoves-room] P7 session', action, 'failed:', res.status, res.statusText);
      return { ok: false, status: res.status };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, detail: (data as { session_id?: string }).session_id };
  } catch (err) {
    console.warn('[pmoves-room] P7 session', action, 'unreachable:', err);
    return { ok: false, status: 0, detail: String(err) };
  }
}

// ---- per-app display helpers (used during registerApp) ----

function appDisplayName(app: RoomApp): string {
  return app.app_id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function appIconForKind(kind: string): string {
  switch (kind) {
    case 'chat':
      return 'MessageCircle';
    case 'browser':
      return 'LayoutGrid';
    case 'notebook':
      return 'BookOpen';
    case 'graph':
      return 'Newspaper';
    case 'media':
      return 'Video';
    case 'controls':
      return 'Settings';
    case 'tasks':
      return 'Circle';
    case 'logs':
      return 'Radio';
    case 'custom':
    default:
      return 'LayoutGrid';
  }
}

function appColorForKind(kind: string): string {
  switch (kind) {
    case 'chat':
      return '#7C3AED'; // violet (PMOVES brand)
    case 'browser':
      return '#0EA5E9'; // sky
    case 'notebook':
      return '#10B981'; // emerald
    case 'graph':
      return '#F59E0B'; // amber
    case 'media':
      return '#EC4899'; // pink
    case 'controls':
      return '#1E40AF'; // blue
    default:
      return '#7C3AED';
  }
}

function defaultSizeForKind(kind: string): { width: number; height: number } {
  switch (kind) {
    case 'chat':
      return { width: 420, height: 560 };
    case 'browser':
      return { width: 960, height: 640 };
    case 'notebook':
      return { width: 760, height: 600 };
    case 'graph':
      return { width: 900, height: 540 };
    case 'media':
      return { width: 720, height: 540 };
    case 'controls':
      return { width: 480, height: 600 };
    default:
      return { width: 600, height: 400 };
  }
}

function panelDisplayName(panel: RoomPanel): string {
  return panel.panel_id
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Re-export the window type alias so consumers can type their refs.
export type { WindowState };
