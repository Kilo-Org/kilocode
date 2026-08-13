// kilocode_change - new file
//
// Runs the HttpApi exerciser's three gates, optionally across several processes
// on one machine.
//
// The exerciser cannot run its scenarios concurrently inside one process --
// `resetState` in runner.ts calls `disposeApps()` and `disposeAllInstances()`
// between scenarios, which would tear down a concurrent scenario's app -- but it
// is already safe across processes, because environment.ts keys both the
// database and the XDG root on `process.pid`. CI exploited that with six
// single-lane runners; this script exploits it inside one runner instead.
//
// Why that trade is worth making: a lane is not CPU-hungry enough to justify a
// machine. Measured locally (arm64, 10 performance cores), one lane over 14
// effect scenarios takes 14.6s at 182% CPU -- so ~1.8 cores of appetite against
// the 4 vCPU each CI shard had to itself. Throughput per added lane, same
// scenarios, all on one box:
//
//   lanes  wall   scenarios/s  speedup
//     1    14.6s     0.96       1.00x
//     3    17.7s     2.37       2.47x
//     4    19.5s     2.87       2.99x
//     6    25.5s     3.18       3.31x
//     8    43.8s     2.47       2.57x   <- past this box's 10 real cores
//
// The peak sits at roughly cores/1.8 lanes, which is what the ~1.8-core appetite
// predicts, and every lane above it is thrashing rather than working. So size a
// runner by lanes * 2 vCPU and stop; CI's `KILO_HTTPAPI_LANES` is chosen that
// way against its vCPU count, not turned up hopefully.
//
// Sharding composes rather than being replaced: with `KILO_HTTPAPI_SHARD=s/S`
// and L lanes, lane i runs global slice `((s-1)*L + i)/(S*L)`, so the scenario
// partition is still `shardScenarios`'s and a matrix of runners can each hold
// several lanes. Unset lanes (or `1`) reproduces the old sequential chain
// exactly, which is what `bun run test:httpapi` does locally.

import { TestShard } from "./test-shard"

const MODES = ["coverage", "auth", "effect"] as const
const ARGS = ["--fail-on-missing", "--fail-on-skip"] as const
const EXERCISER = "script/httpapi-exercise.ts"

function fail(message: string): never {
  console.error(`httpapi-lanes: ${message}`)
  process.exit(1)
}

function lanes() {
  const raw = process.env["KILO_HTTPAPI_LANES"]?.trim()
  if (!raw) return 1
  const value = Number(raw)
  // A typo here would silently serialise the whole suite onto one lane, which
  // reads as "the exerciser got 6x slower" in CI rather than as a bad env var.
  if (!Number.isSafeInteger(value) || value < 1 || value > 64) {
    fail(`invalid KILO_HTTPAPI_LANES "${raw}"; expected an integer 1..64`)
  }
  return value
}

function shard() {
  const parsed = TestShard.parse(process.env["KILO_HTTPAPI_SHARD"]?.trim() || undefined)
  if (!parsed.ok) fail(parsed.error)
  return parsed.value ?? { index: 1, total: 1 }
}

/** One lane: the three gates in order, stopping at the first failure. */
async function run(slice: { index: number; total: number } | undefined, capture: boolean) {
  const out: Uint8Array[] = []
  for (const mode of MODES) {
    const proc = Bun.spawn(["bun", "run", EXERCISER, "--mode", mode, ...ARGS], {
      env: {
        ...process.env,
        // Children must not re-enter this script's fan-out, and each needs its
        // own slice rather than the job's.
        KILO_HTTPAPI_LANES: "1",
        ...(slice ? { KILO_HTTPAPI_SHARD: `${slice.index}/${slice.total}` } : {}),
      },
      stdout: capture ? "pipe" : "inherit",
      stderr: capture ? "pipe" : "inherit",
    })
    if (capture) {
      // Buffer both streams and flush per lane. Interleaving eight lanes of
      // per-scenario PASS lines live would make the log unreadable, and the
      // gates report nothing useful until they finish anyway.
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
      ])
      out.push(new Uint8Array(stdout), new Uint8Array(stderr))
    }
    const code = await proc.exited
    if (code !== 0) return { mode, code, out }
  }
  return { mode: undefined, code: 0, out }
}

const total = lanes()
const outer = shard()
const global = outer.total * total
const slices = Array.from({ length: total }, (_, i) => ({
  index: (outer.index - 1) * total + i + 1,
  total: global,
}))

if (total === 1) {
  // Single lane keeps the old streaming behaviour: no capture, no prefixes, and
  // no shard override when nothing asked for one.
  const only = global === 1 ? undefined : slices[0]
  const result = await run(only, false)
  if (result.code !== 0) fail(`gate --mode ${result.mode} failed with exit ${result.code}`)
  process.exit(0)
}

console.log(`httpapi-lanes: ${total} lanes over slices ${slices.map((s) => `${s.index}/${s.total}`).join(" ")}`)

const started = performance.now()
const results = await Promise.all(slices.map((slice) => run(slice, true)))

for (const [i, result] of results.entries()) {
  const slice = slices[i]
  console.log(`\n=== lane ${i + 1} (shard ${slice.index}/${slice.total}) ${result.code === 0 ? "ok" : "FAILED"}`)
  for (const chunk of result.out) process.stdout.write(chunk)
}

const elapsed = ((performance.now() - started) / 1000).toFixed(1)
const failed = results.filter((result) => result.code !== 0)
console.log(`\nhttpapi-lanes: ${total - failed.length}/${total} lanes passed in ${elapsed}s`)
if (failed.length > 0) {
  for (const [i, result] of results.entries()) {
    if (result.code !== 0)
      console.error(`httpapi-lanes: lane ${i + 1} failed --mode ${result.mode} (exit ${result.code})`)
  }
  process.exit(1)
}
