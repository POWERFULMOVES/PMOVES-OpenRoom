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

    it('archive stage: registers apps but does not open any windows', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');
      const { clearPmovesApps, getPmovesRegisteredCount } = await import('../appRegistry');
      const { getWindows } = await import('../windowManager');

      clearPmovesApps();

      const manifest = {
        room_id: 'archive.room.example',
        stage: 'archive' as const,
        display_name: 'Archive Example',
        shell: {
          layout: {
            panels: [
              { panel_id: 'left-panel', kind: 'custom', position: 'left', size: 40, pinned: true },
              { panel_id: 'right-panel', kind: 'custom', position: 'right', size: 40, pinned: true },
            ],
          },
        },
        apps: [
          { app_id: 'app-a', kind: 'custom', route: '/archive/a' },
          { app_id: 'app-b', kind: 'custom', route: '/archive/b' },
        ],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ session_id: 'arch-session' }),
      });

      const loaded = await loadPmovesRoom('archive.room.example');

      // Apps still registered (so the registry stays consistent for the
      // close handler) — but no windows opened.
      expect(getPmovesRegisteredCount()).toBe(2);
      expect(getWindows()).toHaveLength(0);
      // Stage attribute set so StubApp banner + document CSS see the
      // archive state.
      expect(docRoot.attrs['data-pmoves-stage']).toBe('archive');
      // Cleanup
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await loaded.dispose();
    });

    it('applies stage attribute even without accent_color', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');

      const manifest = {
        room_id: 'no-theme.room.example',
        stage: 'live' as const,
        display_name: 'No Theme Example',
        // No shell.theme.accent_color — should still set data-pmoves-stage.
        apps: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ session_id: 'no-theme-session' }),
      });

      const loaded = await loadPmovesRoom('no-theme.room.example');

      // Stage is set even though accent_color was missing (regression
      // for the chatgpt-codex P2 "Apply room stage even without an
      // accent color").
      expect(docRoot.attrs['data-pmoves-room']).toBe('no-theme.room.example');
      expect(docRoot.attrs['data-pmoves-stage']).toBe('live');
      // --pm-accent NOT set (no accent in the manifest).
      expect(
        (docRoot.style.setProperty as unknown as { mock: { calls: unknown[] } })
          .mock.calls.find((c) => Array.isArray(c) && c[0] === '--pm-accent'),
      ).toBeUndefined();

      // Cleanup
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await loaded.dispose();
    });

    it('applies every optional theme field and removes them on dispose', async () => {
      const { loadPmovesRoom } = await import('../pmovesRoomAdapter');

      // The prior tests covered data-pmoves-room, data-pmoves-stage and
      // cleanup, and nothing asserted skin / icon / accent / wallpaper --
      // so applyTheme could stop setting any of them and the suite stayed
      // green (coderabbitai, PR #3).
      const manifest = {
        room_id: 'themed.room.example',
        stage: 'live' as const,
        display_name: 'Themed Example',
        shell: {
          theme: {
            accent_color: '#ff8800',
            skin: 'midnight',
            icon: 'https://example.invalid/icon.svg',
            wallpaper: 'url(https://example.invalid/bg.png)',
          },
        },
        apps: [],
      };

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => manifest,
      });
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ session_id: 'themed-session' }),
      });

      const loaded = await loadPmovesRoom('themed.room.example');

      const setCalls = (docRoot.style.setProperty as unknown as { mock: { calls: string[][] } })
        .mock.calls;
      const valueOf = (name: string) => setCalls.filter((c) => c[0] === name).map((c) => c[1])[0];

      expect(valueOf('--pm-accent')).toBe('#ff8800');
      expect(valueOf('--pm-skin')).toBe('midnight');
      expect(valueOf('--pm-icon')).toBe('https://example.invalid/icon.svg');
      // Read from the DECLARED shell.theme.wallpaper, not through a cast.
      expect(valueOf('--pm-wallpaper')).toBe('url(https://example.invalid/bg.png)');

      expect(docRoot.attrs['data-pmoves-skin']).toBe('midnight');
      expect(docRoot.attrs['data-pmoves-icon']).toBe('https://example.invalid/icon.svg');

      // Cleanup must remove every one of them: a room that leaks its skin
      // into the next room is the failure this disposal exists to prevent.
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
      await loaded.dispose();

      const removed = (
        docRoot.style.removeProperty as unknown as { mock: { calls: string[][] } }
      ).mock.calls.map((c) => c[0]);
      expect(removed).toEqual(
        expect.arrayContaining(['--pm-accent', '--pm-skin', '--pm-icon', '--pm-wallpaper']),
      );
      expect(docRoot.attrs['data-pmoves-skin']).toBeUndefined();
      expect(docRoot.attrs['data-pmoves-icon']).toBeUndefined();
    });
  });
});
