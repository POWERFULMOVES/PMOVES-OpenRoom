/**
 * StubApp — fallback renderer for PMOVES room apps (openroom-adapter, 2026-07-24).
 *
 * Real PMOVES apps are server-rendered services (e.g. demo.room.rehearsal
 * points to agent-zero-webui, claude-code-session, hermes-assist) that the
 * adapter will wire up in a follow-up slice. Until each is wired, the
 * StubApp displays the manifest metadata so the operator can see what's
 * declared and which services would normally be active.
 *
 * Reads the app's displayName + appName from the window via windowManager
 * state. Stage discipline is read from the document root's data-pmoves-stage
 * attribute (set by the room adapter) and shown as a banner.
 *
 * Not interactive: clicking the "Open live service" button is a no-op in the
 * rehearsal stage and a stub-redirect in live (to be wired when the app
 * adapters land).
 */

import React from 'react';
import { getAppDisplayName } from '@/lib/appRegistry';
import { getWindows } from '@/lib/windowManager';

const STAGE_BANNERS: Record<string, { color: string; text: string }> = {
  rehearsal: { color: '#F59E0B', text: 'PREVIEW — not connected to live services' },
  review: { color: '#0EA5E9', text: 'READ-ONLY — review mode' },
  archive: { color: '#6B7280', text: 'ARCHIVED — app disabled' },
  live: { color: '#10B981', text: 'LIVE' },
};

const StubApp: React.FC = () => {
  // Find this window's appId via the rendered title's lookup. We can't pass
  // appId through React props without restructuring AppWindow; instead we
  // scan windowManager for the active (non-minimized) window whose title
  // matches. If multiple match, the user-visible window is the topmost.
  const allWindows = typeof window !== 'undefined' ? getWindows() : [];
  const top = [...allWindows].sort((a, b) => b.zIndex - a.zIndex)[0];
  const appId = top?.appId ?? -1;
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
          PMOVES app stub — the real service wiring is queued in the
          openroom-adapter follow-up lane. This window reflects the room
          manifest's <code>apps[]</code> entry: provider, route, capabilities.
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
              alert(
                'Live service routing is queued in the openroom-adapter follow-up lane.',
              )
            }
          >
            Open live service (stub)
          </button>
        ) : (
          <p style={{ marginTop: 12, fontSize: 12, color: '#9ca3af' }}>
            Interactions are disabled in {stage} stage. Promote the room to{' '}
            <code>live</code> via the P7 stage transition API to enable this
            app.
          </p>
        )}
      </div>
    </div>
  );
};

export default StubApp;
