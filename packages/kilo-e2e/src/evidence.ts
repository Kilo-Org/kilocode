import { isAbsolute, relative, resolve } from "node:path"
import { DriverResult, EvidenceReport, type ScenarioManifest } from "./schema"
import { SecretFieldError, assertNoSecrets } from "./redact"

export class EvidenceError extends Error {
  constructor(
    readonly code: "invalid" | "secret" | "artifact_path" | "mismatch" | "capability",
    message: string,
  ) {
    super(message)
    this.name = "EvidenceError"
  }
}

export function parseDriverResult(input: unknown, manifest: ScenarioManifest, runId: string): DriverResult {
  const parsed = DriverResult.safeParse(input)
  if (!parsed.success) throw new EvidenceError("invalid", "driver result does not match its schema")
  const result = parsed.data
  if (result.runId !== runId) throw new EvidenceError("mismatch", "driver result run id does not match")
  if (result.scenarioId !== manifest.id) throw new EvidenceError("mismatch", "driver result scenario does not match")
  if (result.lane !== manifest.lane) throw new EvidenceError("mismatch", "driver result lane does not match")
  const missing = manifest.requires.filter((capability) => !result.capabilities.includes(capability))
  if (missing.length > 0) throw new EvidenceError("capability", `driver is missing capabilities: ${missing.join(", ")}`)
  if (result.outcome === "passed") {
    const failed = result.assertions.filter((assertion) => assertion.status === "failed")
    if (failed.length > 0) throw new EvidenceError("mismatch", "driver outcome contradicts its failed assertions")
    const passed = new Set(result.assertions.filter((assertion) => assertion.status === "passed").map((a) => a.name))
    const expected = [...manifest.expected.ui, ...manifest.expected.model].filter((name) => !passed.has(name))
    if (expected.length > 0)
      throw new EvidenceError("mismatch", `driver is missing passing assertions for: ${expected.join(", ")}`)
  }
  return result
}

function assertArtifactsInside(report: EvidenceReport, runDir: string) {
  const root = resolve(runDir)
  const paths = [...report.artifacts.logs, ...report.artifacts.screenshots, ...report.artifacts.snapshots]
  for (const artifact of paths) {
    if (isAbsolute(artifact)) throw new EvidenceError("artifact_path", "artifact paths must be relative")
    const target = resolve(root, artifact)
    const rel = relative(root, target)
    if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel))
      throw new EvidenceError("artifact_path", "artifact path escapes the run directory")
  }
}

export function validateEvidence(input: unknown, runDir: string): EvidenceReport {
  try {
    assertNoSecrets(input)
  } catch (error) {
    if (error instanceof SecretFieldError)
      throw new EvidenceError("secret", `secret material rejected at ${error.path}`)
    throw error
  }
  const parsed = EvidenceReport.safeParse(input)
  if (!parsed.success) throw new EvidenceError("invalid", "evidence does not match its schema")
  assertArtifactsInside(parsed.data, runDir)
  return parsed.data
}
