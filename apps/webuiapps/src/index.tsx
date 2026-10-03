import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import rootRouter from '@/routers';

import './common.scss';
import { initI18n } from './i18';
import {
  loadPmovesRoomIfPresent,
  resolvePanelUrl,
  type PmovesRoomPanel,
} from './lib/pmovesRoomAdapter';
import { openRoomPanelWindow } from './lib/windowManager';

declare const __ROUTER_BASE__: string;

initI18n();

const basename = typeof __ROUTER_BASE__ !== 'undefined' && __ROUTER_BASE__ ? __ROUTER_BASE__ : '/';

function openRoomPanel(panel: PmovesRoomPanel): void {
  if (panel.kind === 'chat') return; // chat is the resident ChatPanel window
  const url = resolvePanelUrl(panel);
  if (!url) return;
  openRoomPanelWindow({ title: panel.panel_id, url });
}

async function bootstrap(): Promise<void> {
  // PMOVES room adapter: resolve room state before the first render so the
  // character manager and desktop panels observe it deterministically.
  const room = await loadPmovesRoomIfPresent();
  const panels = room?.shell?.layout?.panels ?? [];
  for (const panel of panels) {
    openRoomPanel(panel);
  }

  const router = createBrowserRouter(rootRouter, { basename });
  ReactDOM.createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
}

void bootstrap();