import React, { useRef, useCallback, lazy, Suspense } from 'react';
import { X, Minus } from 'lucide-react';
import {
  type WindowState,
  closeWindow,
  focusWindow,
  minimizeWindow,
  moveWindow,
  resizeWindow,
} from '@/lib/windowManager';
import { getSourceDirToAppId, PMOVES_DYNAMIC_APP_ID_BASE } from '@/lib/appRegistry';
import { reportUserOsAction } from '@/lib/vibeContainerMock';
import styles from './index.module.scss';

/** Auto-discover all App pages via import.meta.glob, build appId to lazy component mapping */
const pageModules = import.meta.glob('../../pages/*/index.tsx') as Record<
  string,
  () => Promise<{ default: React.ComponentType }>
>;
const dirToAppId = getSourceDirToAppId();
const APP_COMPONENTS: Record<number, React.LazyExoticComponent<React.ComponentType>> = {};
for (const [path, loader] of Object.entries(pageModules)) {
  const dirMatch = path.match(/\/pages\/([^/]+)\//);
  if (!dirMatch) continue;
  const appId = dirToAppId[dirMatch[1]];
  if (appId) APP_COMPONENTS[appId] = lazy(loader);
}

// StubApp: fallback renderer for PMOVES-room apps (openroom-adapter lane).
// Loaded lazily; used for any window whose appId is in the PMOVES_DYNAMIC range
// (1000+). When the real app adapter is wired for a given manifest entry,
// the lookup above will win once a built-in sourceDir is associated.
const StubApp = lazy(() => import('@/pages/StubApp'));

interface Props {
  win: WindowState;
}

const AppWindow: React.FC<Props> = ({ win }) => {
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(
    null,
  );
  const resizeRef = useRef<{ startX: number; startY: number; winW: number; winH: number } | null>(
    null,
  );

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      focusWindow(win.appId);
      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winW: win.width,
        winH: win.height,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizeRef.current) return;
        const dx = ev.clientX - resizeRef.current.startX;
        const dy = ev.clientY - resizeRef.current.startY;
        resizeWindow(win.appId, resizeRef.current.winW + dx, resizeRef.current.winH + dy);
      };

      const handleMouseUp = () => {
        resizeRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [win.appId, win.width, win.height],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      focusWindow(win.appId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const dx = ev.clientX - dragRef.current.startX;
        const dy = ev.clientY - dragRef.current.startY;
        moveWindow(win.appId, dragRef.current.winX + dx, dragRef.current.winY + dy);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [win.appId, win.x, win.y],
  );

  const AppComp = APP_COMPONENTS[win.appId];
  // PMOVES-room apps (appId >= 1000) have no built-in sourceDir. Render the
  // StubApp fallback which surfaces manifest metadata + the stage discipline
  // banner. When a real app adapter is wired for a given manifest entry,
  // it will register a built-in sourceDir and win this lookup.
  const isPmovesApp = win.appId >= PMOVES_DYNAMIC_APP_ID_BASE;
  if (!AppComp && !isPmovesApp) return null;

  if (win.minimized) return null;

  return (
    <div
      className={styles.window}
      data-testid={`app-window-${win.appId}`}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
      }}
      onMouseDown={() => focusWindow(win.appId)}
    >
      <div className={styles.titleBar} onMouseDown={handleMouseDown}>
        <span className={styles.title}>{win.title}</span>
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={() => minimizeWindow(win.appId)}
            title="Minimize"
          >
            <Minus size={12} />
          </button>
          <button
            className={`${styles.actionBtn} ${styles.closeBtn}`}
            onClick={() => {
              closeWindow(win.appId);
              reportUserOsAction('CLOSE_APP', { app_id: String(win.appId) });
            }}
            title="Close"
            data-testid={`window-close-${win.appId}`}
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.contentInner}>
          <Suspense fallback={<div className={styles.loading}>Loading...</div>}>
            {isPmovesApp ? <StubApp /> : <AppComp />}
          </Suspense>
        </div>
      </div>
      <div className={styles.resizeHandle} onMouseDown={handleResizeMouseDown} />
    </div>
  );
};

export default AppWindow;
