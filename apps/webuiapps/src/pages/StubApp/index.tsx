/**
 * StubApp — fallback renderer for PMOVES room apps (openroom-adapter, 2026-07-24).
 *
 * Real PMOVES apps are server-rendered services (e.g. demo.room.rehearsal
 * points to agent-zero-webui, claude-code-session, hermes-assist) that the
 * adapter will wire up in a follow-up slice. Until each is wired, the
 * StubApp displays the manifest metadata so the operator can see what's
 * declared and which services would normally be active.
 *
 * Receives its own appId as a prop from AppWindow (chatgpt-codex P2 fix:
 * before, every StubApp instance scanned windowManager for the topmost
 * window, so multiple PMOVES windows all showed the same metadata).
 * Stage discipline is read from the document root's data-pmoves-stage
 * attribute (set by the room adapter) and shown as a banner.
 *
 * Not interactive: clicking the "Open live service" button is a no-op in the
 * rehearsal stage and a stub-redirect in live (to be wired when the app
 * adapters land).
 */

import React from 'react';
import { getAppDisplayName } from '@/lib/appRegistry';

const STAGE_BANNERS: Record<string, { color: string; text: string }> = {
  rehearsal: { color: '#F59E0B', text: 'PREVIEW — not connected to live services' },
  review: { color: '#0EA5E9', text: 'READ-ONLY — review mode' },
  archive: { color: '#6B7280', text: 'ARCHIVED — app disabled' },
  live: { color: '#10B981', text: 'LIVE' },
};

const StubApp: React.FC<{ appId: number }> = ({ appId }) => {
  // appId is the window's own id (passed by AppWindow). No more scanning
  // windowManager for the topmost — every StubApp now shows its own
  // metadata. chatgpt-codex P2: this restores the invariant that
  // distinct PMOVES windows have distinct identities.
  const displayName = appId > 0 ? getAppDisplayName(appId) : 'PMOVES App';

  // Read stage from document root attribute (set by pmovesRoomAdapter).
  const stage =
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-pmoves-stage') || 'rehearsal'
      : 'rehearsal';
  const roomId =
    typeof document !== 'undefined'
      ? document.documentElement.getAttribute('data-pmoves-room') || ''
      : '';
  const banner = STAGE_BANNERS[stage] || STAGE_BANNERS.rehearsal;

  const isInteractive = stage === 'live';

  // openroom-adapter Level B: render the real room surface in-window when an
  // iframe URL is configured for this room via VITE_PMOVES_ROOM_IFRAMES —
  // a JSON map { "<room_id>": "<served-url>" }. This is how a rendered room
  // (e.g. the persona living-doc static bundle) actually shows inside the
  // desktop instead of the metadata stub. No entry → the stub below.
  const iframeUrl = React.useMemo(() => {
    try {
      const raw = import.meta.env.VITE_PMOVES_ROOM_IFRAMES as string | undefined;
      if (!raw || !roomId) return '';
      const map = JSON.parse(raw) as Record<string, string>;
      return map[roomId] || '';
    } catch {
      return '';
    }
  }, [roomId]);

  if (iframeUrl) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: '6px 12px',
            background: banner.color,
            color: '#fff',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {banner.text} {roomId && <span style={{ opacity: 0.7 }}>· {roomId}</span>}
        </div>
        <iframe
          title={displayName}
          src={iframeUrl}
          style={{ flex: 1, width: '100%', border: 'none' }}
          // Hardened for public/mesh exposure: the room's own scripts + external
          // link pop-outs only. No allow-same-origin (a served room surface never
          // needs the desktop's origin/storage — a null origin is safer) and no
          // allow-forms.
          sandbox="allow-scripts allow-popups"
        />
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        color: 'var(--pm-text, #1f2937)',
      }}
    >
      <div
        style={{
          padding: '6px 12px',
          background: banner.color,
          color: '#fff',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
        }}
      >
        {banner.text} {roomId && <span style={{ opacity: 0.7 }}>· {roomId}</span>}
      </div>
      <div style={{ padding: '16px 20px', flex: 1, overflow: 'auto' }}>
        <h2 style={{ margin: '0 0 8px 0', fontSize: 18 }}>{displayName}</h2>
        <p style={{ margin: '0 0 12px 0', color: '#6b7280', fontSize: 13 }}>
          PMOVES app stub — the real service wiring is queued in the openroom-adapter follow-up
          lane. This window reflects the room manifest's <code>apps[]</code> entry: provider, route,
          capabilities.
        </p>
        <dl style={{ fontSize: 12, lineHeight: 1.5 }}>
          <dt style={{ fontWeight: 600, color: '#374151' }}>appId</dt>
          <dd style={{ margin: '0 0 8px 12px', fontFamily: 'monospace' }}>{appId}</dd>
          <dt style={{ fontWeight: 600, color: '#374151' }}>stage</dt>
          <dd style={{ margin: '0 0 8px 12px' }}>{stage}</dd>
          <dt style={{ fontWeight: 600, color: '#374151' }}>room</dt>
          <dd style={{ margin: '0 0 8px 12px', fontFamily: 'monospace' }}>{roomId || '(none)'}</dd>
        </dl>
        {isInteractive ? (
          <button
            type="button"
            style={{
              marginTop: 12,
              padding: '6px 14px',
              background: 'var(--pm-accent, #7C3AED)',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
            onClick={() =>
              // Deliberate stub affordance: the message names the follow-up lane.
              // Replacing it with in-page UI is a UX change and does not belong in
              // the PR that turns CI on.
              // eslint-disable-next-line no-alert
              alert('Live service routing is queued in the openroom-adapter follow-up lane.')
            }
          >
            Open live service (stub)
          </button>
        ) : (
          <p style={{ marginTop: 12, fontSize: 12, color: '#9ca3af' }}>
            Interactions are disabled in {stage} stage. Promote the room to <code>live</code> via
            the P7 stage transition API to enable this app.
          </p>
        )}
      </div>
    </div>
  );
};

export default StubApp;
