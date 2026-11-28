// kilocode_change - new file
/**
 * The hand-over between the publish jobs of .github/workflows/publish.yml.
 *
 * publish-build packs the npm tarballs, pushes and describes the container images and writes the
 * distribution evidence. It hands over two directories: `publish-stage.json` and the evidence
 * (artifact `publish-build`, small), and the tarballs (artifact `publish-tarballs`); the stage
 * file's sha256 is a job output. release-undraft reads the stage and the evidence, uploads the
 * evidence to the draft, checks the draft and publishes the release; publish then reads the stage
 * and the tarballs and publishes the tarballs to npm. read() checks the recorded sha256 and the
 * sha256 of every file the reader needs.
 *
 * Imports only Node built-ins, so release-undraft runs it without installing packages.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { digest as sha256 } from "./sbom/artifact.ts"
import type { Entry } from "./sbom/manifest.ts"

export const FILENAME = "publish-stage.json"

export type Tarball = { name: string; version: string; file: string; sha256: string }

export type Stage = {
  version: string
  /** The npm tarballs to publish, in publishing order (the platform packages, then the launcher). */
  tarballs: Tarball[]
  /** Distribution evidence files for the draft, by file name, with their sha256. */
  files: { file: string; sha256: string }[]
  /** The distribution manifest entries; on a re-run after the release was published, the npm entries to compare. */
  entries: Entry[]
}

const NAME = /^[A-Za-z0-9@][A-Za-z0-9._+@-]*$/
const SHA256 = /^[0-9a-f]{64}$/

/** The two directories of the hand-over: the stage file and evidence (small), and the npm tarballs. */
export type Dirs = { stage: string; tarballs: string }

/**
 * Copies the evidence files into `dirs.stage` and the tarballs into `dirs.tarballs` under their
 * file names, writes the stage file into `dirs.stage` and returns its sha256.
 */
export async function write(
  dirs: Dirs,
  input: {
    version: string
    tarballs: { name: string; version: string; path: string }[]
    files: string[]
    entries: Entry[]
  },
) {
  await mkdir(dirs.stage, { recursive: true })
  await mkdir(dirs.tarballs, { recursive: true })
  const copy = async (source: string, dir: string) => {
    const file = path.basename(source)
    if (!NAME.test(file)) throw new Error(`Unsupported file name ${JSON.stringify(file)}`)
    await copyFile(source, path.join(dir, file))
    return { file, sha256: await sha256(source) }
  }
  const stage: Stage = {
    version: input.version,
    tarballs: [],
    files: [],
    entries: input.entries,
  }
  for (const item of input.tarballs) {
    stage.tarballs.push({ name: item.name, version: item.version, ...(await copy(item.path, dirs.tarballs)) })
  }
  for (const file of input.files) stage.files.push(await copy(file, dirs.stage))
  const target = path.join(dirs.stage, FILENAME)
  await writeFile(target, `${JSON.stringify(stage, null, 2)}\n`)
  return sha256(target)
}

/**
 * Reads the stage file in `stage`. Fails unless it has the sha256 publish-build recorded and its
 * version is `version`. With `need: "evidence"` every evidence file must be a plain file name in
 * `stage` with the recorded sha256 (release-undraft); with `need: "tarballs"` every tarball must be
 * one in `tarballs` (publish). Returns the stage with absolute paths for what it checked.
 */
export async function read(input: {
  stage: string
  tarballs?: string
  digest: string
  version: string
  need: "evidence" | "tarballs"
}) {
  const { digest, version } = input
  if (!SHA256.test(digest)) throw new Error("The publish-build job recorded no stage digest")
  const file = path.join(input.stage, FILENAME)
  const actual = await sha256(file)
  if (actual !== digest) throw new Error(`${FILENAME} has sha256 ${actual}; publish-build recorded ${digest}`)
  const stage: Stage = JSON.parse(await readFile(file, "utf8"))
  if (stage.version !== version) {
    throw new Error(`${FILENAME} is for version ${JSON.stringify(stage.version)}, not ${version}`)
  }
  const resolve = async (item: { file: string; sha256: string }, dir: string) => {
    if (!NAME.test(item.file) || !SHA256.test(item.sha256)) {
      throw new Error(`Invalid stage file ${JSON.stringify(item.file)}`)
    }
    const full = path.join(dir, item.file)
    const got = await sha256(full)
    if (got !== item.sha256) throw new Error(`${item.file} has sha256 ${got}; publish-build recorded ${item.sha256}`)
    return full
  }
  const tarballs = input.tarballs
  if (input.need === "tarballs" && !tarballs) throw new Error("The publish-tarballs directory is required")
  return {
    version: stage.version,
    entries: stage.entries,
    tarballs:
      input.need === "tarballs" && tarballs
        ? await Promise.all(stage.tarballs.map(async (item) => ({ ...item, file: await resolve(item, tarballs) })))
        : [],
    files: input.need === "evidence" ? await Promise.all(stage.files.map((item) => resolve(item, input.stage))) : [],
  }
}
