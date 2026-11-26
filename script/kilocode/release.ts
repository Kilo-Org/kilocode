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
 * Uploading one asset per request makes each attempt independently retryable, and
 * deleting an existing asset of that name first (what `--clobber` did) removes the
 * ghost or half-written asset left by the previous attempt, so "already exists"
 * resolves itself instead of being fatal. A file that exhausts its attempts is
 * reported with every other failure at the end rather than cancelling assets that
 * would have succeeded. Every request addresses the release by its database id.
 */

import { execFile, spawn } from "node:child_process"
import { once } from "node:events"
import { createWriteStream } from "node:fs"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { setTimeout } from "node:timers/promises"
import { promisify } from "node:util"

const exec = promisify(execFile)

export type Asset = { id?: number; name: string; state?: string; digest?: string | null }

export type Release = { id: number; draft: boolean; tag_name: string; upload_url: string }

/** Outcome of one asset upload. */
export type Result = { ok: boolean; message: string }

export type Options = {
  /** Release tag, e.g. `v7.8.6`; the release must be the draft for it. */
  tag: string
  /**
   * Release database id. Requests address the release by id, never by tag: a draft
   * has no tag yet, and two drafts can carry the same tag name.
   */
  release?: string
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

function repo() {
  const value = process.env.GH_REPO
  if (!value) throw new Error("GH_REPO is required to address the release")
  return value
}

async function api(args: string[]) {
  const res = await exec("gh", ["api", ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  return res.stdout
}

/** The release with this database id. */
export async function view(id: string): Promise<Release> {
  return JSON.parse(await api([`repos/${repo()}/releases/${id}`]))
}

/** The release with this id, which must carry `tag`. */
export async function release(id: string, tag: string) {
  const found = await view(id)
  if (found.tag_name !== tag) throw new Error(`Release ${id} is for ${found.tag_name}, not ${tag}`)
  return found
}

export async function assets(id: string): Promise<Asset[]> {
  const out = await api(["--paginate", "--jq", ".[]", `repos/${repo()}/releases/${id}/assets`])
  return out
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
}

/** Writes the bytes of release asset `id` to `file`. */
export async function download(id: number, file: string) {
  const proc = spawn("gh", ["api", "-H", "Accept: application/octet-stream", `repos/${repo()}/releases/assets/${id}`], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "inherit"],
  })
  const closed = once(proc, "close")
  await pipeline(proc.stdout, createWriteStream(file))
  const [code] = await closed
  if (code !== 0) throw new Error(`gh api could not download release asset ${id} (exit ${code})`)
}

export async function remove(id: number) {
  await api(["--method", "DELETE", `repos/${repo()}/releases/assets/${id}`])
}

/** Publishes the release with this id: it stops being a draft and its tag is created. */
export async function undraft(id: string, fields: string[]) {
  await api(["--method", "PATCH", `repos/${repo()}/releases/${id}`, "-F", "draft=false", ...fields])
}

/** `gh release upload --clobber`, addressed by release id: drop an asset of the same name, then upload. */
function pusher(id: string, url: string) {
  return async (file: string): Promise<Result> => {
    const name = path.basename(file)
    try {
      const existing = (await assets(id)).find((item) => item.name === name)
      if (existing?.id) await remove(existing.id)
      const target = `${url.replace(/\{.*\}$/, "")}?name=${encodeURIComponent(name)}`
      await api(["--method", "POST", "-H", "Content-Type: application/octet-stream", "--input", file, target])
      return { ok: true, message: "" }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
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
  let push = input.push
  if (!push) {
    // Uploads go only to the draft with this id, checked once more right before the first upload.
    if (!input.release) throw new Error("upload needs the release id")
    const target = await release(input.release, input.tag)
    if (!target.draft) throw new Error(`Release ${input.release} (${input.tag}) is published. Nothing was uploaded.`)
    push = pusher(input.release, target.upload_url)
  }
  const id = input.release
  const list = input.list ?? (() => assets(id!))

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
    await setTimeout(delay)
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
