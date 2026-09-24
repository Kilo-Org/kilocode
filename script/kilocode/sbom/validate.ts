/**
 * Structural and policy validation for Kilo SBOM documents.
 *
 * Schema-shaped correctness -- required properties, type/enum/pattern
 * conformance, hash and licence object shapes, and everything else the
 * official CycloneDX 1.6 JSON Schema already expresses -- is delegated to
 * `@cyclonedx/cyclonedx-library`'s ajv-backed validator instead of being
 * re-implemented by hand.
 *
 * What remains here is Kilo policy the schema cannot express: an SBOM that is
 * schema-valid but does not name the artifact it describes, or whose
 * dependency graph points at components that were filtered out, is still
 * useless to a market surveillance authority. Schema issues and policy issues
 * are reported together so a release either has usable evidence or a precise
 * list of what is wrong.
 */

import { createRequire } from "node:module"
import { PROPERTY_NAMESPACE, serial } from "./model"

const SHA256 = /^[0-9a-f]{64}$/
const SCOPES = new Set(["required", "optional", "excluded"])
const DELIVERIES = new Set(["contained", "provided", "runtime"])
const VERSIONED = new Set(["library", "framework", "application", "container", "operating-system"])

type Record_ = Record<string, any>

type SchemaIssue = { instancePath?: string; message?: string }
type CycloneDxLibrary = {
  Validation: {
    JsonValidator: new (version: string) => { validate(data: string): Promise<null | SchemaIssue | SchemaIssue[]> }
    MissingOptionalDependencyError: new (...args: unknown[]) => Error
  }
  Spec: { Version: { v1dot6: string } }
}

// `@cyclonedx/cyclonedx-library` ships a dual node/browser conditional
// `types` export, and `packages/opencode`'s shared tsconfig sets
// `customConditions: ["browser"]` project-wide (an upstream opencode
// setting, applied to the whole program rather than per-file). That makes a
// typed `import` of this package resolve the browser variant everywhere that
// tsconfig applies -- including this Node-only script, whose browser variant
// does not implement `JsonValidator` at all. Loading it through `require()`
// with an explicit local type for the handful of members actually used
// sidesteps that conditional type resolution instead of overriding a shared,
// non-Kilo tsconfig setting.
const cdx = createRequire(import.meta.url)("@cyclonedx/cyclonedx-library") as CycloneDxLibrary

const schema = new cdx.Validation.JsonValidator(cdx.Spec.Version.v1dot6)

/**
 * Run the document through the official CycloneDX 1.6 JSON Schema.
 *
 * A missing `ajv`/`ajv-formats`/`ajv-formats-draft2019` install degrades to a
 * single reported issue rather than throwing, matching how `scan.ts` degrades
 * when Syft is unavailable: schema coverage can be temporarily lost without
 * making the whole validator unusable.
 */
async function schemaIssues(input: unknown) {
  const result = await schema.validate(JSON.stringify(input)).catch((err: unknown) => {
    if (err instanceof cdx.Validation.MissingOptionalDependencyError) {
      return [{ message: `schema validator unavailable: ${err.message}` }]
    }
    throw err
  })
  if (!result) return []
  const errors = Array.isArray(result) ? result : [result]
  return errors.map((issue: SchemaIssue) => {
    const path = issue.instancePath || "<root>"
    return `schema: ${path} ${issue.message ?? JSON.stringify(issue)}`
  })
}

function property(bom: Record_, name: string) {
  const list: Record_[] = bom.metadata?.properties ?? []
  return list.find((item) => item?.name === `${PROPERTY_NAMESPACE}:${name}`)?.value
}

export async function validate(input: unknown) {
  const bom = input as Record_
  if (typeof bom !== "object" || bom === null) return ["SBOM is not an object"]

  const issues = await schemaIssues(input)

  const meta = bom.metadata
  if (typeof meta !== "object" || meta === null) return [...issues, "metadata is required"]
  const tools: Record_[] = meta.tools?.components ?? []
  if (!tools.some((tool) => tool?.name === "kilo-sbom")) {
    issues.push("metadata.tools.components must record the generating tool")
  }

  const root = meta.component
  if (typeof root !== "object" || root === null) return [...issues, "metadata.component is required"]

  const subject = property(bom, "subject:name")
  const digest = property(bom, "subject:sha256")
  if (!subject) issues.push(`metadata must declare ${PROPERTY_NAMESPACE}:subject:name`)
  if (!digest || !SHA256.test(digest)) {
    issues.push(`metadata must declare a lowercase hex ${PROPERTY_NAMESPACE}:subject:sha256`)
  }
  if (!property(bom, "release:version")) issues.push(`metadata must declare ${PROPERTY_NAMESPACE}:release:version`)

  // The root hash is what an authority correlates with the downloaded asset, so
  // it has to agree with the declared subject digest.
  const rootHash = (root.hashes ?? []).find((item: Record_) => item?.alg === "SHA-256")?.content
  if (!rootHash) issues.push("metadata.component must carry a SHA-256 hash of the artifact")
  if (rootHash && digest && rootHash !== digest) {
    issues.push(`metadata.component SHA-256 ${rootHash} does not match subject digest ${digest}`)
  }
  if (digest && SHA256.test(digest) && bom.serialNumber !== serial(digest)) {
    issues.push("serialNumber is not derived from the subject digest, so the document is not reproducible")
  }

  if (!Array.isArray(bom.components)) return [...issues, "components must be an array"]

  const refs = new Set<string>([root["bom-ref"]])
  for (const item of bom.components as Record_[]) {
    const name = item?.name ?? "<unnamed>"
    if (item?.["bom-ref"]) {
      if (refs.has(item["bom-ref"])) issues.push(`duplicate bom-ref ${item["bom-ref"]}`)
      refs.add(item["bom-ref"])
    }
    if (VERSIONED.has(item?.type) && !item?.version) issues.push(`component ${name} requires a version`)
    if (item?.scope != null && !SCOPES.has(item.scope)) issues.push(`component ${name} has invalid scope ${item.scope}`)

    const delivery = ((item?.properties ?? []) as Record_[]).find(
      (entry) => entry?.name === `${PROPERTY_NAMESPACE}:delivery`,
    )?.value
    if (!delivery) issues.push(`component ${name} must declare ${PROPERTY_NAMESPACE}:delivery`)
    if (delivery && !DELIVERIES.has(delivery)) issues.push(`component ${name} has invalid delivery ${delivery}`)
    if (delivery === "provided" && item?.scope !== "excluded") {
      issues.push(`component ${name} is host-provided and must use scope "excluded"`)
    }
    if (delivery === "contained" && item?.scope !== "required") {
      issues.push(`component ${name} is contained and must use scope "required"`)
    }
  }

  if (!Array.isArray(bom.dependencies)) return [...issues, "dependencies must be an array"]

  const declared = new Set<string>()
  for (const edge of bom.dependencies as Record_[]) {
    if (!edge?.ref) {
      issues.push("every dependency entry requires a ref")
      continue
    }
    if (declared.has(edge.ref)) issues.push(`duplicate dependency entry ${edge.ref}`)
    declared.add(edge.ref)
    if (!refs.has(edge.ref)) issues.push(`dependency ref ${edge.ref} does not resolve to a component`)
    for (const target of edge.dependsOn ?? []) {
      if (!refs.has(target)) issues.push(`dependency ${edge.ref} -> ${target} does not resolve to a component`)
    }
  }
  if (!declared.has(root["bom-ref"])) issues.push("dependencies must include the artifact root")
  for (const item of refs) {
    if (!declared.has(item)) issues.push(`component ${item} is missing from the dependency graph`)
  }

  return issues
}

export async function assertValid(bom: unknown, label: string) {
  const issues = await validate(bom)
  if (issues.length) throw new Error(`${label} is not a valid Kilo SBOM:\n- ${issues.join("\n- ")}`)
}
