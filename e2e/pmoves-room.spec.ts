import { test, expect } from '@playwright/test';

/**
 * PMOVES room realization — end-to-end coverage for the `?room=<id>` flow.
 *
 * WHY THIS FILE EXISTS
 *
 * PR #3 landed the whole room-realization path (pmovesRoomAdapter, StubApp,
 * stage discipline) and `e2e/app.spec.ts` was never extended: every spec in it
 * does `page.goto('/')` and exercises the upstream shell. CLAUDE.md's task
 * completion bar is explicit that this is not enough --
 *
 *   "E2E coverage must be complete for impacted user flows. Do not stop at
 *    smoke tests if the change affects real behavior. Cover the primary user
 *    path, key state transitions, and at least one meaningful assertion of
 *    successful behavior."
 *
 * -- so the room flow shipped under the bar, and the gap was only visible from
 * outside: with no spec here, verifying a room meant hand-rolling a Playwright
 * script next to this harness. That is what these tests replace.
 *
 * NOT MOCKED. `vite.config.ts::pmovesRoomsPlugin` serves
 * `/api/rooms/<id>.json` in dev from the monorepo's real
 * `pmoves/config/rooms/` (or `PMOVES_ROOMS_DIR`), so these specs read the same
 * manifests P7 and the container read. A room renamed or deleted there fails
 * here, which is the point.
 */

// A real room in pmoves/config/rooms/, declaring three panels and
// stage: rehearsal. Chosen because it is stage-gated: it exercises the
// disabled branch, which is the state every room starts in.
const ROOM_ID = '4090-field.room.control';

test.describe('PMOVES room — manifest composition', () => {
  test('?room=<id> composes the room and stamps its identity on the document', async ({ page }) => {
    await page.goto(`/?room=${ROOM_ID}`);

    // The adapter records what it loaded on the document root. These are the
    // stable hooks StubApp itself reads, so asserting them checks the same
    // contract the UI depends on rather than a parallel one.
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-pmoves-room', ROOM_ID);
    await expect(root).toHaveAttribute('data-pmoves-stage', 'rehearsal');

    // At least one app window from the manifest's apps[] is rendered.
    const apps = page.locator('[data-testid="pmoves-room-app"]');
    await expect(apps.first()).toBeVisible();

    // ...and it reports THIS room, not a leftover from another window.
    await expect(page.locator('[data-testid="pmoves-room-value"]').first()).toHaveText(ROOM_ID);
  });

  test('the stage banner names the room it belongs to', async ({ page }) => {
    await page.goto(`/?room=${ROOM_ID}`);

    const banner = page.locator('[data-testid="pmoves-stage-banner"]').first();
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(ROOM_ID);
  });
});

test.describe('PMOVES room — stage discipline', () => {
  test('a rehearsal room disables interaction and offers no live affordance', async ({ page }) => {
    await page.goto(`/?room=${ROOM_ID}`);

    await expect(page.locator('[data-testid="pmoves-stage-value"]').first()).toHaveText(
      'rehearsal',
    );

    // The gate: StubApp renders the locked notice OR the live button, never
    // both. Asserting only the notice would pass if the button leaked in
    // alongside it, so assert the button's absence too -- that absence IS the
    // stage guarantee.
    await expect(page.locator('[data-testid="pmoves-stage-locked"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="pmoves-open-live"]')).toHaveCount(0);
  });
});

test.describe('PMOVES room — the upstream shell is unaffected', () => {
  test('no ?room= leaves the shell with no room identity', async ({ page }) => {
    await page.goto('/');

    // Regression guard for the adapter's own early return: it must not
    // compose, theme, or stage-stamp anything when no room was requested.
    // Without this, a bug that loaded a default room would still pass every
    // spec above.
    await expect(page.locator('[data-testid="shell"]')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-pmoves-room', /.+/);
    await expect(page.locator('[data-testid="pmoves-room-app"]')).toHaveCount(0);
  });

  test('an unknown room id degrades to the shell instead of breaking it', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/?room=this-room-does-not-exist');

    // The manifest fetch 404s. The desktop must still come up -- a room that
    // is not there is an operator mistake, not a reason to lose the shell.
    await expect(page.locator('[data-testid="shell"]')).toBeVisible();
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
