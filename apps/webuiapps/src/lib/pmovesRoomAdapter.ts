/**
 * PMOVES Room Adapter - loads room manifests (catalog.json + <room>.json)
 * and applies room configuration to this OpenRoom app.
 *
 * Sources are tried in order:
 *   1. VITE_PMOVES_ROOMS_BASE_URL + /catalog.json   (configurable origin)
 *   2. /api/rooms/catalog.json                      (same-origin nginx alias
 *      over the /etc/pmoves/rooms read-only volume mount)
 *
 * Room selection: /room/<id> path > <id>.* hostname > VITE_PMOVES_ROOM_DEFAULT
 * > first non-demo live/rehearsal room.
 * Consumed state: document data-pmoves-* attributes, CSS var --pm-accent,
 * window.pmovesRoom, and the 'pmoves-room-loaded' CustomEvent.
 */

export interface PmovesRoomPanel {
  panel_id: string;
  kind: string;
  position?: string;
  size?: number;
  pinned?: boolean;
}

export interface PmovesRoomManifest {
  room_id: string;
  version?: string;
  stage?: string;
  display_name?: string;
  description?: string;
  agent_id: string;
  alter?: string;
  room_type?: string;
  owner_mode?: string;
  shell?: {
    theme?: { theme_id?: string; accent_color?: string; skin?: string; icon?: string };
    layout?: { default_route?: string; panels?: PmovesRoomPanel[] };
  };
  persona?: {
    signature_ref?: string;
    role?: string[];
    voice?: string;
    register?: string[];
    /** Optional manifest-authored opening line; overrides the template. */
    prologue?: string;
    /** Optional glyph for the no-media avatar placeholder. */
    glyph?: string;
    /** Optional persona media; flows into CharacterMetaInfo. */
    avatar_img_url?: string;
    base_image_url?: string;
    emotion_images?: Record<string, string>;
  };
}

export interface PmovesCatalogRow {
  room_id?: string;
  stage?: string;
  manifest?: string;
}

const env: Record<string, string | undefined> =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};

let activeRoom: PmovesRoomManifest | null = null;

const DEFAULT_IFRAMES: Record<string, string> = {
  notebook: 'http://host.docker.internal:8503',
  'pub-gate-notebook': 'http://host.docker.internal:8503',
};

function candidateBases(): string[] {
  const bases: string[] = [];
  if (env.VITE_PMOVES_ROOMS_BASE_URL) bases.push(env.VITE_PMOVES_ROOMS_BASE_URL.replace(/\/$/, ''));
  bases.push('/api/rooms');
  return bases;
}

async function fetchJson<T>(paths: string[]): Promise<T | null> {
  for (const p of paths) {
    try {
      const res = await fetch(p, { cache: 'no-store' });
      if (!res.ok) continue;
      return (await res.json()) as T;
    } catch {
      /* try next source */
    }
  }
  return null;
}

function detectRoomId(catalog: { rooms?: PmovesCatalogRow[] }): string | null {
  const rooms = catalog.rooms || [];
  const ids = rooms.map(r => String(r.room_id || '')).filter(Boolean);
  const qRoom = new URLSearchParams(window.location.search).get('room');
  if (qRoom && ids.includes(qRoom)) return qRoom;
  const pathMatch = window.location.pathname.match(/\/room\/([A-Za-z0-9._-]+)/);
  if (pathMatch && ids.includes(pathMatch[1])) return pathMatch[1];
  const hostMatch = window.location.hostname.match(/^([A-Za-z0-9._-]+?)\./);
  if (hostMatch && ids.includes(hostMatch[1])) return hostMatch[1];
  const def = env.VITE_PMOVES_ROOM_DEFAULT;
  if (def && ids.includes(def)) return def;
  const preferred = rooms.find(
    r => !String(r.room_id || '').startsWith('demo') && (r.stage === 'live' || r.stage === 'rehearsal')
  );
  return String(preferred?.room_id || rooms[0]?.room_id || '') || null;
}

function applyManifest(m: PmovesRoomManifest): void {
  const root = document.documentElement;
  root.setAttribute('data-pmoves-room', m.room_id);
  root.setAttribute('data-pmoves-stage', String(m.stage || ''));
  root.setAttribute('data-pmoves-agent', String(m.agent_id || ''));
  if (m.alter) root.setAttribute('data-pmoves-alter', m.alter);
  const theme = m.shell?.theme;
  if (theme?.accent_color) root.style.setProperty('--pm-accent', theme.accent_color);
  if (theme?.skin) root.setAttribute('data-pmoves-skin', theme.skin);
  (window as unknown as { pmovesRoom?: PmovesRoomManifest }).pmovesRoom = m;
}

export function resolvePanelUrl(panel: PmovesRoomPanel): string | null {
  let configured: Record<string, string> = {};
  try {
    if (env.VITE_PMOVES_ROOM_IFRAMES) configured = JSON.parse(env.VITE_PMOVES_ROOM_IFRAMES) as Record<string, string>;
  } catch {
    configured = {};
  }
  const map = { ...DEFAULT_IFRAMES, ...configured };
  return map[panel.panel_id] || map[panel.kind] || null;
}

export async function loadPmovesRoomIfPresent(): Promise<PmovesRoomManifest | null> {
  try {
    const bases = candidateBases();
    const catalog = await fetchJson<{ rooms?: PmovesCatalogRow[] }>(
      bases.map(b => b + '/catalog.json')
    );
    if (!catalog || !catalog.rooms || !catalog.rooms.length) return null;
    const roomId = detectRoomId(catalog);
    if (!roomId) return null;
    const row = (catalog.rooms || []).find(r => r.room_id === roomId);
    const file = row?.manifest || roomId + '.json';
    const manifest = await fetchJson<PmovesRoomManifest>(bases.map(b => b + '/' + file));
    if (!manifest || !manifest.room_id) return null;
    applyManifest(manifest);
    activeRoom = manifest;
    document.dispatchEvent(new CustomEvent('pmoves-room-loaded', { detail: manifest }));
    console.info('[pmovesRoomAdapter] room loaded:', manifest.room_id, manifest.display_name);
    return manifest;
  } catch (err) {
    console.warn('[pmovesRoomAdapter] load failed:', err);
    return null;
  }
}


/**
 * Room-aware opening line for the chat window. Priority:
 * manifest persona.prologue > manifest-driven template > null (stock mod prologue).
 */
export function getRoomPrologue(): string | null {
  const room = getActiveRoom();
  if (!room) return null;
  if (room.persona?.prologue) return String(room.persona.prologue);
  const name = room.display_name || room.agent_id || 'this room';
  const desc = room.description ? ' ' + room.description : '';
  return 'You are in ' + name + '.' + desc + ' The room is yours - what do you need?';
}

export function getActiveRoom(): PmovesRoomManifest | null {
  return activeRoom;
}
