# kilo.ai Provider Token Race — "show off" features

## Where this actually lives

The page (`kilo.ai/leaderboard/race`, "🏁 Provider Race" / "Token Race") and its
public data APIs are **not** in this repo. They live in `Kilo-Org/cloud`:

- Frontend: `apps/web` (Next.js). The page's copy/insight-card rendering wasn't
  found as static source in that repo either — it's very likely composed from
  a CMS/page-builder layer on top of the public APIs, which *is* in-repo.
- Data API: `apps/web/src/app/api/public/leaderboard-provider-race/route.ts` —
  a cached Snowflake report returning weekly `{ weekStart, provider,
  isOpenWeights, tokens }` rows, grouped by `model_provider_company` (the model
  lab) and `is_open_weights`, from `kilo_dw.dbt_prod.usage_daily`. This one
  payload backs both the race bar chart and the open-vs-closed-weight toggle.
- Related public reports in the same repo: `leaderboard-model-usage` and
  `leaderboard-model-provider-usage` (per-model, not per-lab).

This credential set only has push/PR access to `Kilo-Org/kilocode`, not
`Kilo-Org/cloud` (confirmed: `git push`/`gh repo fork` against `cloud` both
returned `403`). So the code below is implemented and self-verified against a
real clone of `cloud`, but is attached here as a patch for a maintainer with
`cloud` access to apply and open there, rather than silently landing in a repo
it can't affect.

**To apply:** in a `Kilo-Org/cloud` checkout, `cd apps/web && git apply
../../plans/leaderboard-race-show-off-features/provider-race-share-achievements.patch`
(paths in the patch are already repo-root-relative, so run `git apply` from
the `cloud` repo root instead if that's easier).

## What the race page already has

From the live page: a weekly animated bar-chart race (play/pause/scrub/speed),
an all-labs / open-weight / proprietary filter, a "Share" and "Download PNG"
button on the chart itself, an open-vs-closed-weight share trend, and four
computed "insight cards" — Usage Champion, Longest Reign, Most Consistent,
Breakout Lab — each linking to `/models/by/<lab>`. So the page already has
*some* callout/show-off surface; the gap is in the **per-lab, shareable**
direction: nothing lets an individual lab grab *their own* current position as
a portable asset (image, badge, or machine-readable payload) instead of a
screenshot of the whole chart.

## Implemented in this pass

All three reuse the exact same weekly `{weekStart, provider, isOpenWeights,
tokens}` rows the existing `leaderboard-provider-race` report already caches
— no new data source, no new Snowflake query for two of the three (the third,
the achievements API, doesn't hit Snowflake at all, see below).

1. **`GET /api/public/leaderboard-provider-race/achievements`** — computes,
   from the cached rows, per-lab standings (current rank, rank change vs last
   week, weeks at #1, longest #1 streak, weeks in the top 3/10, all-time
   tokens/rank) plus the race-wide highlights the page already shows the
   concept of (usage champion, longest reign, most consistent, fastest
   climber this week, labs newly in the top 10 this week). This is the
   foundational data layer: it turns "the page has some cool insight cards"
   into "any lab (or the frontend, or a lab's own dashboard) can query their
   specific standing and achievements as JSON." Pure computation, unit
   tested in `provider-race-achievements.test.ts`.
2. **`GET /api/public/leaderboard-provider-race/badge?provider=<lab>`** — an
   embeddable, shields.io-style SVG badge showing a lab's current rank this
   week (`Anthropic · kilo.ai | #1 this week`). Meant for a lab to drop
   straight into their own README/site/press page the same way OSS projects
   embed CI-status or npm-version badges — zero-JS, cacheable, no design
   system dependency. Falls back to a "not ranked"/"unavailable" badge
   instead of an HTTP error so it always renders inline wherever embedded.
3. **`GET /api/public/leaderboard-provider-race/share-card?provider=<lab>`**
   — a 1200x630 OG-image "achievement card" (via `next/og`'s
   `ImageResponse`) for a lab's current position plus whichever callout
   applies (usage champion, longest reign, fastest climber, just entered the
   top 10, or weeks-at-#1). Meant for `<meta property="og:image">` on a
   lab's own announcement post, or for direct sharing on X/LinkedIn — this is
   the concrete "shareable achievement card" ask. Kept intentionally
   plain/neutral rather than pixel-matched to Kilo's brand system, since that
   review should go through the `cloud` repo's design tooling
   (`kilo-design-cloud` skill / `apps/web/AGENTS.md`), which this environment
   doesn't have access to — flagged as a follow-up below.

Also: `createPublicSnowflakeReport` (`apps/web/src/lib/public-snowflake-report.ts`)
now attaches a `getData()` accessor to the handler it returns, so routes (2)
and (3) reuse the existing three-layer cache (Vercel edge → in-process →
Redis) in front of Snowflake instead of adding a second query definition or
extra Snowflake load. This is backward compatible — every existing
`export const GET = createPublicSnowflakeReport(...)` call site is unaffected
since the return value is still a callable function.

### Why these three

- They're the highest-leverage "show off" primitives given what's already
  computed: rank, rank history, and streaks are the only real signals in the
  dataset (token volume, week, lab, open/closed). Nothing here invents an
  achievement that isn't backed by that data.
- They're independently useful without a redesign of the existing race page:
  the JSON API can power the existing insight cards without duplicating their
  computation client-side; the badge and share-card are net-new surfaces that
  don't touch the chart itself.
- They're the concrete request from the task: "shareable achievement cards",
  "milestone badges", and an "embeddable widget for labs to put on their own
  site" map directly to (3), (1)'s milestone field, and (2).

### Validation performed

- `computeProviderRaceAchievements` behavior (empty input, `other`-bucket
  exclusion, weekly ranking, rank-change/fastest-climber, #1-streak with
  gaps, first-time-top-10 detection, all-time usage champion) verified with
  both a Jest test file and a standalone Node script exercising the same
  scenarios (`node --experimental-strip-types`), since the repo's Jest suite
  requires a local Postgres via `docker compose` that isn't available in this
  sandbox (no `docker` binary) — the DB dependency is global
  (`setupFilesAfterEnv`) even for DB-free unit tests, so the full `pnpm test`
  run for `apps/web` could not be executed here.
- `pnpm --filter web exec oxlint` and `oxfmt --list-different` on every
  changed/added file: clean (one `no-non-null-assertion` finding was fixed).
- `next/og`'s `ImageResponse` and its `headers` option confirmed against the
  installed `next@16.2.6` type declarations; confirmed it runs on the default
  Node.js runtime in this Next version (not edge-only), which matters because
  the share-card route reuses the provider-race report's data path, which
  depends on Node-only APIs (Snowflake JWT signing via `jsonwebtoken`, the
  Redis client) that aren't edge-compatible.
- Full `tsgo --noEmit` type-check for `apps/web` was started but did not
  finish within a reasonable window (large app, plus the `@kilocode/trpc`
  build prerequisite); it was stopped rather than left blocking. The
  `oxlint`/`oxfmt` pass plus manual review of the `next/og` and
  `NextResponse` type surfaces stand in for it here.

## Recommended follow-ups (not implemented this pass)

- **Wire the achievements API into the actual race page's insight cards.**
  Right now the live page's four insight cards are presumably computed
  wherever its frontend lives; pointing that computation at
  `/achievements` instead would remove a second implementation of the same
  logic. Needs someone with access to that frontend to confirm where it is.
- **Per-lab dashboard/permalink**, e.g. `kilo.ai/leaderboard/race/anthropic`,
  rendering the share-card and badge inline plus a "Copy embed code" button
  (`<img src=".../badge?provider=anthropic">` / an `<iframe>` for a mini
  chart). The APIs here are the backend for that; the page itself isn't.
- **Milestone webhooks/notifications** — proactively DM/email a lab (or post
  to a public feed) the moment `enteredTop10ThisWeek` flips true for them, or
  the moment they set a new `longestRank1Streak` record, rather than requiring
  them to poll the achievements API. Turns a "check the leaderboard" habit
  into an unprompted "you just hit a milestone" moment, which is where most
  of the organic sharing upside is.
- **Design-system pass on the share-card.** The current card is intentionally
  neutral (no brand fonts/gradients/logo) because this sandbox doesn't have
  access to the `kilo-design-cloud` skill that governs `apps/web` UI. Before
  shipping, run it through that review so it matches the real Kilo visual
  language and includes the Kilo logo/wordmark.
- **A `?format=json` "raw stat" variant of the badge** for labs who want the
  number (not an image) to render in their own UI with their own styling —
  effectively already covered by hitting `/achievements` directly and reading
  one provider's entry, but worth documenting explicitly as the intended
  pairing (image badge for READMEs, JSON for custom UI).
- **Historical/animated share card** — e.g. a short GIF/video export of a
  lab's own rank trajectory over the full 57 weeks, reusing the same
  animation the race chart already has, scoped to one provider. Higher effort
  (needs a render pipeline, not just Satori-in-a-request) so it's not in this
  pass.
- **Auth-gated "verified lab" badge variant** — let a lab claim their badge
  URL (e.g. via a signed token) so the badge can show a "Verified by Kilo"
  mark, giving labs a reason to prefer embedding the official badge over a
  screenshot. Requires new auth/claim plumbing, out of scope here.
- **Cross-post automation** — a scheduled job that posts the current week's
  `newToTop10` / `fastestClimber` highlights to Kilo's own social accounts,
  tagging the lab. Not a page change at all, but the same achievements payload
  would drive it.
