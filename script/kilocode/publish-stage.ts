// kilocode_change - new file
/**
 * The hand-over between the publish jobs of .github/workflows/publish.yml.
 *
 * publish-build packs the npm tarballs, pushes and describes the container images and writes the
 * distribution evidence; it puts them, with `publish-stage.json`, into one directory (artifact
 * `publish-build`) and records that file's sha256 as a job output. release-undraft uploads the
 * evidence to the draft, checks the draft and publishes the release; publish then publishes the
 * tarballs to npm. Both read the directory with read(), which checks the recorded sha256 and the
 * sha256 of every file the stage names.
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

/**
 * Copies the tarballs and evidence files into `dir` under their file names, writes the stage file
 * and returns its sha256.
 */
export async function write(
  dir: string,
  input: {
    version: string
    tarballs: { name: string; version: string; path: string }[]
    files: string[]
    entries: Entry[]
  },
) {
  await mkdir(dir, { recursive: true })
  const copy = async (source: string) => {
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
  for (const item of input.tarballs)
    stage.tarballs.push({ name: item.name, version: item.version, ...(await copy(item.path)) })
  for (const file of input.files) stage.files.push(await copy(file))
  const target = path.join(dir, FILENAME)
  await writeFile(target, `${JSON.stringify(stage, null, 2)}\n`)
  return sha256(target)
}

/**
 * Reads the stage in `dir`. Fails unless the stage file has the sha256 publish-build recorded, every
 * file it names is a plain file name in `dir` with the recorded sha256, and its version is `version`.
 * Returns the stage with absolute paths.
 */
export async function read(dir: string, digest: string, version: string) {
  if (!SHA256.test(digest)) throw new Error("The publish-build job recorded no stage digest")
  const file = path.join(dir, FILENAME)
  const actual = await sha256(file)
  if (actual !== digest) throw new Error(`${FILENAME} has sha256 ${actual}; publish-build recorded ${digest}`)
  const stage: Stage = JSON.parse(await readFile(file, "utf8"))
  if (stage.version !== version)
    throw new Error(`${FILENAME} is for version ${JSON.stringify(stage.version)}, not ${version}`)
  const resolve = async (item: { file: string; sha256: string }) => {
    if (!NAME.test(item.file) || !SHA256.test(item.sha256))
      throw new Error(`Invalid stage file ${JSON.stringify(item.file)}`)
    const full = path.join(dir, item.file)
    const got = await sha256(full)
    if (got !== item.sha256) throw new Error(`${item.file} has sha256 ${got}; publish-build recorded ${item.sha256}`)
    return full
  }
  return {
    version: stage.version,
    entries: stage.entries,
    tarballs: await Promise.all(stage.tarballs.map(async (item) => ({ ...item, file: await resolve(item) }))),
    files: await Promise.all(stage.files.map(resolve)),
  }
}
