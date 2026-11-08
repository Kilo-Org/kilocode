/**
 * Publish GitHub release assets without letting one flaky transfer discard the set.
 *
 * `gh release upload --clobber` is not safe for a large asset set. It uploads every
 * file concurrently through a single `errgroup` and retries an individual upload when
 * the transport fails — but a dropped connection does not mean GitHub rejected the
 * asset. The upload frequently commits server-side and the retry then collides with
 * the asset it just created:
 *
 *     HTTP 422: Validation Failed (.../assets?label=&name=kilo-linux-x64-musl.tar.gz)
 *     ReleaseAsset.name already exists
 *
 * 422 is not retryable, so `gh` fails the command, and the shared errgroup context
 * cancels every upload still in flight. One hiccup on one of the ~26 CLI assets
 * therefore threw away the other 18 and failed `build-cli` after the full build
 * (publish run 37520899871, v7.8.6: 8 of 26 assets landed).
 *
 * Uploading one asset per `gh` invocation makes each attempt independently
 * retryable, and `--clobber` deletes the ghost or half-written asset left by the
 * previous attempt, so "already exists" resolves itself instead of being fatal. A
 * file that exhausts its attempts is reported with every other failure at the end
 * rather than cancelling assets that would have succeeded.
 */

import { $ } from "bun"
import path from "node:path"

export type Asset = { name: string; state?: string }

/** Outcome of one `gh release upload` invocation. */
export type Result = { ok: boolean; message: string }

export type Options = {
  /** Release tag, e.g. `v7.8.6`. Draft releases are resolved by tag like `gh` does. */
  tag: string
  files: string[]
  /** Attempts per file, not for the set as a whole. */
  attempts?: number
  /**
   * Parallel uploads. Deliberately below `gh`'s default of 5: the CLI set is
   * ~1 GB and saturating the runner's uplink is what produces the dropped
   * connections in the first place.
   */
  concurrency?: number
  /** Milliseconds between attempts on the same file. */
  delay?: number
  /** Subprocess boundary, substituted in tests. */
  push?: (file: string) => Promise<Result>
  /** Subprocess boundary, substituted in tests. */
  list?: () => Promise<Asset[]>
}

const ATTEMPTS = 4
const CONCURRENCY = 3
const DELAY = 5_000

function pusher(tag: string) {
  return async (file: string): Promise<Result> => {
    const res = await $`gh release upload ${tag} ${file} --clobber`.nothrow().quiet()
    return {
      ok: res.exitCode === 0,
      message: `${res.stderr.toString()}\n${res.stdout.toString()}`.trim() || `exit code ${res.exitCode}`,
    }
  }
}

function lister(tag: string) {
  return async (): Promise<Asset[]> => {
    const res = await $`gh release view ${tag} --json assets`.nothrow().quiet()
    if (res.exitCode !== 0) throw new Error(res.stderr.toString().trim() || `gh release view ${tag} failed`)
    return ((await res.json()) as { assets?: Asset[] }).assets ?? []
  }
}

/**
 * Names that are expected but are not a completed asset on the release.
 *
 * An upload that reported success can still leave an asset in `starter` state, so
 * the published state is what decides, not the exit code. A listing that cannot be
 * read is reported and skipped: it must not invent a failure for assets `gh` already
 * confirmed.
 */
async function unpublished(input: { tag: string; names: string[]; list: () => Promise<Asset[]> }) {
  const published = await input.list().catch((err) => {
    console.warn(`upload: could not confirm the published assets on ${input.tag}:`, err)
    return undefined
  })
  if (!published) return []
  const states = new Map(published.map((item) => [item.name, item.state ?? "uploaded"]))
  return input.names
    .filter((name) => states.get(name) !== "uploaded")
    .map((name) => `${name}: not published (state=${states.get(name) ?? "absent"})`)
}

/** Upload every file to the release, then confirm the whole set actually landed. */
export async function upload(input: Options) {
  if (input.files.length === 0) return
  const attempts = input.attempts ?? ATTEMPTS
  const delay = input.delay ?? DELAY
  const push = input.push ?? pusher(input.tag)
  const list = input.list ?? lister(input.tag)

  const queue = [...input.files]
  const failures: { name: string; message: string }[] = []

  const one = async (file: string, left: number): Promise<void> => {
    const name = path.basename(file)
    const res = await push(file)
    if (res.ok) {
      console.log(`upload: ${name}`)
      return
    }
    if (left <= 1) {
      failures.push({ name, message: res.message })
      return
    }
    console.warn(
      `upload: ${name} failed (attempt ${attempts - left + 1}/${attempts}), retrying in ${delay / 1000}s: ${res.message}`,
    )
    await Bun.sleep(delay)
    return one(file, left - 1)
  }

  const next = async (): Promise<void> => {
    const file = queue.shift()
    if (!file) return
    await one(file, attempts)
    return next()
  }

  const workers = Math.max(1, Math.min(input.concurrency ?? CONCURRENCY, queue.length))
  await Promise.all(Array.from({ length: workers }, () => next()))

  const names = input.files.map((file) => path.basename(file))
  const failed = new Set(failures.map((item) => item.name))
  const issues = [
    ...failures.map((item) => `${item.name}: ${item.message}`),
    // A name that already reported a failure needs no second line saying it is absent.
    ...(await unpublished({ tag: input.tag, names: names.filter((name) => !failed.has(name)), list })),
  ]
  if (issues.length > 0) throw new Error(`release ${input.tag}: ${issues.length} asset(s) failed\n${issues.join("\n")}`)
  console.log(`upload: ${names.length} asset(s) published to ${input.tag}`)
}
