# Validation road — PMOVES-OpenRoom

**What proves a change here, with the resources that actually exist.**

This repo runs no CI on pull requests to `PMOVES.AI-Edition-Hardened` (see
*Why this file exists*), so local validation is not a convenience — it is the
only gate. Every command below was run on 2026-09-05 and its exact output is
what the "expect" column says.

Do not improvise a substitute. Each wrong turn listed here cost real time on a
single change, and every one of them looked like it was working.

## The road

| To prove | Run | Expect |
|---|---|---|
| Deps resolve | `pnpm install` **at the repo root** | lockfile-clean install |
| Unit tests | `cd apps/webuiapps && pnpm test` | `122 passed (8 files)` |
| Lint, without mutating | `npx eslint <paths>` | compare to baseline; see below |
| Production build | `NODE_ENV=production npx vite build` in `apps/webuiapps` | `✓ built in ~1m` |
| nginx config syntax | `nginx -t` in a container; recipe below | `syntax is ok` |
| nginx behaviour | run two configs, curl both; recipe below | statuses differ or they don't |
| E2E | `pnpm test:e2e` **at the repo root** | `13 passed, 1 failed` — see below |
| Coverage of a file you touched | `npx vitest run --coverage --coverage.include='<path>'` | the config's own `include` is ONE file; see below |

**The E2E row did not exist until 2026-09-08**, which is why nobody noticed
that the suite could not reach the app on a PMOVES node (wrong turn 5) and
that the room flow had no spec at all. `e2e/pmoves-room.spec.ts` now covers
`?room=<id>`: manifest composition, the stage gate, and two shell regression
guards. Verified it can fail — forcing `isInteractive = true` in `StubApp`
turns the stage-discipline spec red, then green again on revert.

The 1 remaining failure is upstream and pre-existing: `app.spec.ts:104`
(`typing a message and clicking send`) needs a configured LLM, and no
`llm.config.json` exists on a clean checkout. Note the suite is inconsistent
about this — `app.spec.ts:50` conditions on it ("shows **either** setup hint
**or** chat messages") while `:104` does not.

**Coverage is narrower than it reports.** `apps/webuiapps/vitest.config.ts`
sets `coverage.include: ['src/lib/llmClient.ts']` with thresholds 75/85/70, so
`pnpm test:coverage` prints a healthy "All files 94.36%" that describes ONE
file. Measured against `src/lib/pmovesRoomAdapter.ts` directly: **80.53%
statements, 65.55% branches, 81.75% lines** — under the >90% that CLAUDE.md's
task-completion bar requires of touched code, and invisible because the file
is not in `include`. CLAUDE.md already anticipates this: *"If current config
thresholds are lower, do not treat that as sufficient."*

## The four wrong turns, so you don't take them

**1. `npm install` inside `apps/webuiapps` produces false failures.**
This is a pnpm workspace (`pnpm-workspace.yaml` at the root) and `i18next` is
declared in the ROOT `package.json`. npm inside the sub-package cannot resolve
hoisted deps, and the suite fails with
`Failed to resolve import "i18next" from "src/lib/vibeContainerMock.ts"` —
6 failures that look like broken code and are a broken install. Under `pnpm`
from the root: 122/122.

**2. `pnpm run lint` REWRITES THE TREE.** The script is
`eslint ./{apps,packages}/**/*.{ts,tsx,js,jsx} --fix …`. Running it as a check
reformatted four files that the change never touched (Prettier reflow, one
`let`→`const`) and `git diff --stat` went from 3 files to 7. Use
`npx eslint <paths>` with no `--fix`, and compare the count against the same
paths at `HEAD` — this repo carries pre-existing findings, so an absolute
number tells you nothing. Baseline on 2026-09-05: **35 problems, 7 errors** for
`pmovesRoomAdapter.ts` + `ChatPanel/index.tsx`.

**3. `pnpm build` fails on Windows.** The script is
`NODE_ENV=production vite build`, which is POSIX-only; cmd.exe reports
`'NODE_ENV' is not recognized`. Set the variable in a POSIX shell instead:
`NODE_ENV=production npx vite build`.

**5. `pnpm test:e2e` silently tests the wrong server on a PMOVES node.**
`playwright.config.ts` used port 3000. On any node running the PMOVES data
tier, `pmoves-supabase-postgrest-1` publishes `127.0.0.1:3000`. Playwright's
`reuseExistingServer` (true outside CI) probes the URL, sees PostgREST answer
`401`, concludes a dev server is already up, **skips `pnpm dev` entirely**, and
runs every spec against the database gateway — 9/9 failing on `toHaveTitle`
receiving `""`, a result that reads like the app is broken.

It is worse than a busy port: vite binds `0.0.0.0:3000` and `[::]:3000` while
Docker holds `127.0.0.1:3000`, so **both** can listen at once and which one a
client reaches depends on how `localhost` resolves. Fixed by moving to 3987
(override with `OPENROOM_E2E_PORT`), invoking vite directly via Playwright's
`cwd` — `pnpm dev --port` sends the flag to `turbo`, which rejects it — and
adding `--strictPort` so vite fails loudly instead of walking to another port.
The 30s `webServer` timeout was also short for a cold start here; now 120s.

**4. Docker paths get mangled by MSYS.** On a Windows/Git-Bash node,
`-c /test/nginx.conf` is rewritten to `C:/Program Files/Git/test/nginx.conf`
and nginx reports a missing file that you did write. Prefix the command with
`MSYS_NO_PATHCONV=1`.

## nginx recipes

`apps/webuiapps/nginx/default.conf` is an http-context fragment, so it needs a
wrapper to test:

```bash
# syntax
printf 'events {}\nhttp {\n  log_format main "$remote_addr $status";\n  include /test/default.conf;\n}\n' > /tmp/ngx/nginx.conf
cp apps/webuiapps/nginx/default.conf /tmp/ngx/
MSYS_NO_PATHCONV=1 docker run --rm -v /tmp/ngx:/test:ro nginx:alpine nginx -t -c /test/nginx.conf
```

**Behaviour, not just syntax.** `nginx -t` accepts configurations that are
wrong. To compare two candidates, run both and measure:

```bash
MSYS_NO_PATHCONV=1 docker run --rm -d --name ngx_a -v /tmp/ab:/test:ro -p 0:8080 \
  nginx:alpine nginx -g 'daemon off;' -c /test/a.conf
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$(docker port ngx_a 8080/tcp | sed 's/.*://')/t"
```

That is how the `error_page` regression in PR #8 was found: `nginx -t` passed
both the broken and the fixed config, and only a request showed that
`error_page 500 502 503 504 = @handler` rewrote a 503 into a 502.

## Why this file exists

Two things were configured and neither gated anything. **Updated 2026-09-08 —
the first is fixed, the second is still open:**

* ~~**`.github/workflows/ci.yml` triggers on `main` only**~~ — **FIXED by #12.**
  The trigger now lists `[main, PMOVES.AI-Edition-Hardened]`, so CI runs on
  PRs to the branch the fleet actually consumes. It produces `lint-and-build`.
  Local validation is therefore no longer the *only* gate — but it is still
  the only gate for anything CI does not run, and CI does not run `test:e2e`
  or `test:coverage`.
* **Branch protection on hardened still has `required_status_checks.contexts:
  []`** — protection is on, `strict: true`, and the set of checks that must
  pass is empty, which is why the closeout gate reports *"no required checks
  were reported"*. Now that `lint-and-build` reports a name, there is finally
  a context to require. Tracked in PMOVES.AI#2979.

Fixing those is sequenced and tracked separately: add hardened to the CI
trigger, let it produce a check name, then require that name. Until then, this
file is the gate.

## Doctrine

CI on GitHub is not the testbed. By the time a change reaches it — if it ever
does — it should already have been proven on the resources the fleet owns:
locally, in the danger room, or on a self-hosted runner. A green check that
runs after the fact confirms; it does not validate.
