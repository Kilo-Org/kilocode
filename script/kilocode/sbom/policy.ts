/**
 * Warning-to-enforcement rollout.
 *
 * SBOM generation is new machinery in the middle of an irreversible publish
 * path, so it starts advisory: failures are reported loudly but do not block a
 * release. Once two consecutive stable releases produce complete, valid,
 * digest-matched evidence, `SBOM_ENFORCE` is set to `true` in a reviewed change
 * and the same failures become release-blocking.
 *
 * The switch is a repository variable rather than an inferred heuristic so the
 * current compliance posture is auditable, and so enforcement can never be
 * silently downgraded by a failing build.
 */

import fs from "node:fs"

export type Policy = { enforce: boolean }

export function policy(env: Record<string, string | undefined> = process.env): Policy {
  return { enforce: /^(1|true|yes)$/i.test(env.SBOM_ENFORCE ?? "") }
}

function annotate(kind: "error" | "warning", message: string) {
  // GitHub Actions annotations; harmless prefixes when run locally.
  for (const line of message.split("\n")) console.log(`::${kind}::${line}`)
}

/**
 * Report SBOM problems according to the current policy.
 *
 * Returns whether the caller should treat the stage as failed. Callers must not
 * publish an artifact whose evidence failed while enforcing.
 */
export function report(input: { label: string; issues: string[]; env?: Record<string, string | undefined> }) {
  const { enforce } = policy(input.env)
  if (!input.issues.length) {
    console.log(`sbom: ${input.label} ok`)
    return { ok: true, enforce }
  }
  const message = [
    `sbom: ${input.label} produced ${input.issues.length} issue(s)`,
    ...input.issues.map((issue) => `  - ${issue}`),
  ].join("\n")
  annotate(enforce ? "error" : "warning", message)
  if (!enforce) console.log("sbom: SBOM_ENFORCE is not set, continuing without blocking the release")
  return { ok: false, enforce }
}

/** Fail the process only when enforcing, so advisory mode cannot break releases. */
export function gate(input: { label: string; issues: string[]; env?: Record<string, string | undefined> }) {
  const result = report(input)
  if (!result.ok && result.enforce) process.exitCode = 1
  return result
}

/**
 * Stop immediately when enforcing.
 *
 * Used ahead of irreversible steps such as a Marketplace upload, where setting
 * an exit code is not enough because the publish would already have happened.
 */
export function block(input: { label: string; issues: string[]; env?: Record<string, string | undefined> }) {
  const result = report(input)
  if (!result.ok && result.enforce) {
    throw new Error(`Refusing to publish: ${input.label} has ${input.issues.length} unresolved SBOM issue(s)`)
  }
  return result
}

export async function summary(input: { product: string; expected: number; ok: number; missing: number }) {
  console.log(`sbom: ${input.product} expected=${input.expected} valid=${input.ok} missing=${input.missing}`)
  const file = process.env.GITHUB_STEP_SUMMARY
  if (!file) return
  const header = "| Product | Expected | Valid | Missing |\n|---|---|---|---|\n"
  const line = `| ${input.product} | ${input.expected} | ${input.ok} | ${input.missing} |`
  // Appended rather than rewritten so a concurrent step's summary is not lost.
  const text = await Bun.file(file)
    .text()
    .catch((err) => {
      console.warn(`sbom: could not read the existing step summary at ${file}`, err)
      return ""
    })
  await fs.promises.appendFile(file, `${text.includes("| Product |") ? "" : header}${line}\n`)
}
