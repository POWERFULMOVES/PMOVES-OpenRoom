/**
 * Simple window manager
 * Manages App window states on the desktop
 */

import { getAppDisplayName, getAppDefaultSize } from './appRegistry';

export interface WindowState {
  appId: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let windows: WindowState[] = [];
let nextZ = 100;
let offsetCounter = 0;

/**
 * Claim the next z-index value from the shared counter.
 * Used by both AppWindow (via focusWindow) and ChatPanel to participate
 * in the same stacking order — click either to bring it to front.
 */
export function claimZIndex(): number {
  return ++nextZ;
}

function notify() {
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getWindows(): WindowState[] {
  return windows;
}

export function openWindow(appId: number): void {
  const existing = windows.find((w) => w.appId === appId);
  if (existing) {
    // Focus existing window
    existing.zIndex = ++nextZ;
    existing.minimized = false;
    windows = [...windows];
    notify();
    return;
  }

  const size = getAppDefaultSize(appId);
  const offset = (offsetCounter++ % 5) * 30;

  const win: WindowState = {
    appId,
    title: getAppDisplayName(appId),
    x: 80 + offset,
    y: 40 + offset,
    width: size.width,
    height: size.height,
    zIndex: ++nextZ,
    minimized: false,
  };

  windows = [...windows, win];
  notify();
}

export function closeWindow(appId: number): void {
  windows = windows.filter((w) => w.appId !== appId);
  notify();
}

export function closeAllWindows(): void {
  windows = [];
  notify();
}

export function focusWindow(appId: number): void {
  const win = windows.find((w) => w.appId === appId);
  if (win) {
    win.zIndex = ++nextZ;
    win.minimized = false;
    windows = [...windows];
    notify();
  }
}

export function minimizeWindow(appId: number): void {
  const win = windows.find((w) => w.appId === appId);
  if (win) {
    win.minimized = true;
    windows = [...windows];
    notify();
  }
}

export function moveWindow(appId: number, x: number, y: number): void {
  const win = windows.find((w) => w.appId === appId);
  if (win) {
    win.x = x;
    win.y = y;
    windows = [...windows];
    notify();
  }
}

export function resizeWindow(appId: number, width: number, height: number): void {
  const win = windows.find((w) => w.appId === appId);
  if (win) {
    win.width = Math.max(300, width);
    win.height = Math.max(200, height);
    windows = [...windows];
    notify();
  }
}

/**
 * Open a window at a specific position and size. Used by the PMOVES room
 * adapter to compose the desktop from a room manifest's shell.layout.panels[].
 * If the window already exists, focuses it.
 */
export function openWindowAt(
  appId: number,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const existing = windows.find((w) => w.appId === appId);
  if (existing) {
    existing.zIndex = ++nextZ;
    existing.minimized = false;
    windows = [...windows];
    notify();
    return;
  }
  const win: WindowState = {
    appId,
    title: getAppDisplayName(appId),
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.max(300, width),
    height: Math.max(200, height),
    zIndex: ++nextZ,
    minimized: false,
  };
  windows = [...windows, win];
  notify();
}

/**
 * Close all PMOVES-registered windows. Used on room exit. Static-app windows
 * (appId < 1000) are preserved.
 */
export function closeAllPmovesWindows(pmovesAppIdBase: number = 1000): void {
  windows = windows.filter((w) => w.appId < pmovesAppIdBase);
  notify();
}
