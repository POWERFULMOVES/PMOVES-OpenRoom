import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Minimal DOM mocks for the adapter's URL parsing + document theme APIs.
let mockSearch = '';
let mockHref = 'https://openroom.pmoves.ai/';
Object.defineProperty(window, 'location', {
  configurable: true,
  get() {
    return {
      get search() {
        return mockSearch;
      },
      get href() {
        return mockHref;
      },
      set href(v: string) {
        mockHref = v;
      },
    } as unknown as Location;
  },
});

interface DocumentStyle {
  setProperty: (k: string, v: string) => void;
  removeProperty: (k: string) => void;
}
interface DocumentRoot {
  style: DocumentStyle;
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  removeAttribute(k: string): void;
  getAttribute(k: string): string | null;
}
const docRoot: DocumentRoot = {
  attrs: {},
  style: {
    setProperty: vi.fn(),
    removeProperty: vi.fn(),
  } as unknown as DocumentStyle,
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  },
  removeAttribute(k: string) {
    delete this.attrs[k];
  },
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  },
};
Object.defineProperty(document, 'documentElement', {
  configurable: true,
  get() {
    return docRoot;
  },
});

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  fetchMock.mockReset();
  mockSearch = '';
  mockHref = 'https://openroom.pmoves.ai/';
  docRoot.attrs = {};
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pmovesRoomAdapter', () => {
  describe('getRoomIdFromUrl', () => {
    it('returns null when ?room is missing', async () => {
      const { getRoomIdFromUrl } = await import('../pmovesRoomAdapter');
      mockSearch = '';
      expect(getRoomIdFromUrl()).toBeNull();
    });

    it('returns the room id when ?room=<id> is present', async () => {
      const { getRoomIdFromUrl } = await import('../pmovesRoomAdapter');
      mockSearch = '?room=demo.room.rehearsal';
      expect(getRoomIdFromUrl()).toBe('demo.room.rehearsal');
    });

    it('rejects path-traversal attempts', async () => {
      const { getRoomIdFromUrl } = await import('../pmovesRoomAdapter');
      mockSearch = '?room=../../etc/passwd';
      expect(getRoomIdFromUrl()).toBeNull();
    });

    it('rejects non-canonical characters', async () => {
      const { getRoomIdFromUrl } = await import('../pmovesRoomAdapter');
      mockSearch = '?room=' + encodeURIComponent('foo bar');
      expect(getRoomIdFromUrl()).toBeNull();
    });
  });

  describe('loadPmovesRoom', () => {
    it('fetches the manifest, registers apps, and opens windows', async () => {
      // Import all modules ONCE per test so vi.resetModules() doesn't
      // create parallel APP_STATIC_REGISTRY instances.
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');
      const { clearPmovesApps, getPmovesRegisteredCount } = await import('../appRegistry');
      const { getWindows } = await import('../windowManager');

      clearPmovesApps();
      expect(getPmovesRegisteredCount()).toBe(0);

      const manifest = {
        room_id: 'demo.room.rehearsal',
        stage: 'rehearsal' as const,
        display_name: 'Demo',
        shell: {
          theme: { accent_color: '#7C3AED' },
          layout: {
            panels: [
              { panel_id: 'agent-zero-main', kind: 'custom', position: 'left', size: 40, pinned: true },
              { panel_id: 'hermes-assist', kind: 'chat', position: 'bottom', size: 20, pinned: false },
            ],
          },
        },
        apps: [
          { app_id: 'agent-zero-webui', kind: 'browser', route: '/demo/agent-zero' },
          { app_id: 'hermes-assist', kind: 'chat', route: '/demo/hermes' },
        ],
      };

      // First call: manifest fetch
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      });
      // Second call: P7 session open
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ session_id: 'test-session-id' }),
      });

      const loaded = await loadPmovesRoom('demo.room.rehearsal');

      // Manifest was fetched from the canonical URL
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/rooms/demo.room.rehearsal.json',
        expect.objectContaining({ credentials: 'same-origin' }),
      );
      // 3 apps registered: 2 from manifest.apps[] + 1 fallback for the
      // agent-zero-main panel (its panel_id doesn't share a substring with
      // either app_id, so resolvePanelRoute returns /agent-zero-main which
      // isn't a registered route, triggering a dynamic registration).
      // The hermes-assist panel matches the hermes-assist app, so no extra.
      expect(getPmovesRegisteredCount()).toBe(3);
      // 2 windows opened (one per panel)
      const windows = getWindows();
      expect(windows).toHaveLength(2);
      // Theme applied to document root
      expect(docRoot.attrs['data-pmoves-room']).toBe('demo.room.rehearsal');
      expect(docRoot.attrs['data-pmoves-stage']).toBe('rehearsal');

      // Cleanup
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await loaded.dispose();
      expect(getPmovesRegisteredCount()).toBe(0);
      expect(getWindows()).toHaveLength(0);
      expect(docRoot.attrs['data-pmoves-room']).toBeUndefined();
    });

    it('throws when manifest room_id does not match the URL', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          room_id: 'other.room',
          stage: 'rehearsal',
          display_name: 'Other',
        }),
      });
      await expect(loadPmovesRoom('demo.room.rehearsal')).rejects.toThrow(
        /room_id mismatch/,
      );
    });

    it('throws when manifest fetch fails', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });
      await expect(loadPmovesRoom('demo.room.rehearsal')).rejects.toThrow(
        /manifest fetch failed/,
      );
    });

    it('P7 session failure does not block the room', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');
      const { clearPmovesApps, getPmovesRegisteredCount } = await import('../appRegistry');

      clearPmovesApps();

      const manifest = {
        room_id: 'demo.room.rehearsal',
        stage: 'live' as const,
        display_name: 'Demo',
        apps: [
          { app_id: 'agent-zero-webui', kind: 'browser', route: '/demo/agent-zero' },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      });
      // P7 session open fails (network error)
      fetchMock.mockRejectedValueOnce(new Error('NATS down'));

      const loaded = await loadPmovesRoom('demo.room.rehearsal');

      // Apps still registered
      expect(getPmovesRegisteredCount()).toBe(1);
      // Cleanup
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await loaded.dispose();
    });
  });
});
