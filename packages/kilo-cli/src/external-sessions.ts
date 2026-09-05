import { readdir, stat } from "node:fs/promises"
import path from "node:path"
import { readExternalTranscript, type ExternalResumeFormat, type ExternalResumeModel } from "./resume-external"

export type ExternalSessionSource = ExternalResumeFormat

export type ExternalSessionEntry = {
  readonly source: ExternalSessionSource
  readonly id: string
  readonly file: string
  readonly bytes: number
  readonly modifiedAt: number
  readonly valid: boolean
  readonly version?: number
  readonly sourceSessionID?: string
  readonly sourceModel?: ExternalResumeModel
  readonly error?: string
}

export type ExternalSessionListInput = {
  /** Explicit absolute source directory. No provider home/default is consulted. */
  readonly directory: string
  readonly source: ExternalSessionSource
  /** v1 displayed at most ten picker entries; this bounded API defaults to ten. */
  readonly limit?: number
}

export type ExternalSessionSelectionInput = ExternalSessionListInput & {
  readonly id: string
}

export class ExternalSessionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExternalSessionError"
  }
}

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const CLAUDE_FILE = new RegExp(`^(${UUID})\\.jsonl$`, "i")
const CODEX_FILE = new RegExp(`^rollout-(.+)-(${UUID})\\.jsonl$`, "i")

export async function listExternalSessions(
  input: ExternalSessionListInput,
): Promise<ReadonlyArray<ExternalSessionEntry>> {
  const directory = await requireDirectory(input)
  const limit = listLimit(input.limit)
  const files = await candidateFiles(directory, input.source)
  const candidates = (await candidatesWithStats(files, input.source))
    .toSorted((left, right) => compareCandidates(left, right, input.source))
    .slice(0, limit)

  return Promise.all(candidates.map((entry) => inspectCandidate(entry, input.source)))
}

/**
 * Resolve one v1-shaped source ID from an explicit directory. The scan is not
 * limited to the ten-entry display window so an older listed session remains
 * selectable by ID. The selected file is parsed again to avoid trusting stale
 * list output.
 */
export async function selectExternalSession(input: ExternalSessionSelectionInput): Promise<ExternalSessionEntry> {
  if (!input.id.trim()) throw new ExternalSessionError("An external session ID is required")
  const directory = await requireDirectory(input)
  const files = await candidateFiles(directory, input.source)
  const match = (await candidatesWithStats(files, input.source)).find(
    (entry): entry is Candidate => entry !== undefined && entry.id === input.id,
  )
  if (!match) {
    throw new ExternalSessionError(`No ${input.source} transcript found with ID: ${input.id}`)
  }

  const entry = await inspectCandidate(match, input.source)
  if (!entry.valid) {
    throw new ExternalSessionError(`External ${input.source} transcript ${input.id} is not importable: ${entry.error}`)
  }
  return entry
}

type Candidate = {
  readonly file: string
  readonly id: string
  readonly modifiedAt: number
  readonly sourceTimestamp?: string
}

async function requireDirectory(input: ExternalSessionListInput) {
  if (!path.isAbsolute(input.directory)) {
    throw new ExternalSessionError("External session discovery requires an explicit absolute directory")
  }
  if (input.source !== "claude" && input.source !== "codex") {
    throw new ExternalSessionError(`Unsupported external session source: ${String(input.source)}`)
  }
  const info = await stat(input.directory).catch(() => undefined)
  if (!info) throw new ExternalSessionError(`External transcript directory not found: ${input.directory}`)
  if (!info.isDirectory())
    throw new ExternalSessionError(`External transcript path is not a directory: ${input.directory}`)
  return input.directory
}

function listLimit(value: number | undefined) {
  if (value === undefined) return DEFAULT_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new ExternalSessionError(`External session list limit must be an integer from 1 to ${MAX_LIMIT}`)
  }
  return value
}

async function candidateFiles(directory: string, source: ExternalSessionSource): Promise<ReadonlyArray<string>> {
  if (source === "claude") return directFiles(directory)
  return recursiveFiles(directory)
}

async function candidatesWithStats(files: ReadonlyArray<string>, source: ExternalSessionSource) {
  const candidates = await Promise.all(
    files.map(async (file) => {
      const parsed = candidate(file, source)
      if (!parsed) return
      const info = await stat(file).catch(() => undefined)
      if (!info?.isFile()) {
        throw new ExternalSessionError(`External transcript file disappeared while listing: ${file}`)
      }
      return { ...parsed, modifiedAt: info.mtimeMs }
    }),
  )
  return candidates.filter((entry): entry is Candidate => entry !== undefined)
}

async function directFiles(directory: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new ExternalSessionError(`Unable to read external transcript directory: ${directory}`)
  })
  return entries.filter((entry) => entry.isFile()).map((entry) => path.join(directory, entry.name))
}

async function recursiveFiles(directory: string): Promise<ReadonlyArray<string>> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => {
    throw new ExternalSessionError(`Unable to read external transcript directory: ${directory}`)
  })
  const files = await Promise.all(
    entries.map((entry) => {
      const file = path.join(directory, entry.name)
      if (entry.isFile()) return Promise.resolve([file])
      if (entry.isDirectory()) return recursiveFiles(file)
      return Promise.resolve([] as ReadonlyArray<string>)
    }),
  )
  return files.flat()
}

function candidate(file: string, source: ExternalSessionSource): Candidate | undefined {
  const name = path.basename(file)
  if (source === "claude") {
    const match = CLAUDE_FILE.exec(name)
    return match ? { file, id: match[1], modifiedAt: 0 } : undefined
  }
  const match = CODEX_FILE.exec(name)
  return match
    ? {
        file,
        id: match[2],
        modifiedAt: 0,
        sourceTimestamp: match[1],
      }
    : undefined
}

async function inspectCandidate(candidate: Candidate, source: ExternalSessionSource): Promise<ExternalSessionEntry> {
  const info = await stat(candidate.file).catch(() => undefined)
  if (!info?.isFile()) {
    throw new ExternalSessionError(`External transcript file disappeared while listing: ${candidate.file}`)
  }

  try {
    const transcript = await readExternalTranscript(candidate.file)
    if (transcript.format !== source) {
      throw new ExternalSessionError(`Expected ${source} transcript, found ${transcript.format}`)
    }
    return {
      source,
      id: candidate.id,
      file: candidate.file,
      bytes: info.size,
      modifiedAt: info.mtimeMs,
      valid: true,
      version: transcript.version,
      ...(transcript.sourceSessionID ? { sourceSessionID: transcript.sourceSessionID } : {}),
      ...(transcript.sourceModel ? { sourceModel: transcript.sourceModel } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      source,
      id: candidate.id,
      file: candidate.file,
      bytes: info.size,
      modifiedAt: info.mtimeMs,
      valid: false,
      error: message,
    }
  }
}

function compareCandidates(left: Candidate, right: Candidate, source: ExternalSessionSource) {
  if (source === "codex") {
    const timestamp = (right.sourceTimestamp ?? "").localeCompare(left.sourceTimestamp ?? "")
    if (timestamp !== 0) return timestamp
  } else {
    const modified = right.modifiedAt - left.modifiedAt
    if (modified !== 0) return modified
  }
  return right.file.localeCompare(left.file)
}
