/**
 * Structural and policy validation for Kilo SBOM documents.
 *
 * This is deliberately stricter than the CycloneDX JSON Schema in the places
 * that matter for CRA evidence: an SBOM that validates against the schema but
 * does not name the artifact it describes, or whose dependency graph points at
 * components that were filtered out, is useless to a market surveillance
 * authority. Schema-shaped checks and Kilo policy checks are reported together
 * so a release either has usable evidence or a precise list of what is wrong.
 */

import { PROPERTY_NAMESPACE, SPEC_VERSION, serial } from "./model"

const SERIAL = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const SCOPES = new Set(["required", "optional", "excluded"])
const DELIVERIES = new Set(["contained", "provided", "runtime"])
const VERSIONED = new Set(["library", "framework", "application", "container", "operating-system"])

type Record_ = Record<string, any>

function property(bom: Record_, name: string) {
  const list: Record_[] = bom.metadata?.properties ?? []
  return list.find((item) => item?.name === `${PROPERTY_NAMESPACE}:${name}`)?.value
}

export function validate(input: unknown) {
  const issues: string[] = []
  const bom = input as Record_
  if (typeof bom !== "object" || bom === null) return ["SBOM is not an object"]

  if (bom.bomFormat !== "CycloneDX") issues.push(`bomFormat must be "CycloneDX", got ${JSON.stringify(bom.bomFormat)}`)
  if (bom.specVersion !== SPEC_VERSION) {
    issues.push(`specVersion must be "${SPEC_VERSION}", got ${JSON.stringify(bom.specVersion)}`)
  }
  if (typeof bom.serialNumber !== "string" || !SERIAL.test(bom.serialNumber)) {
    issues.push(`serialNumber must be a urn:uuid, got ${JSON.stringify(bom.serialNumber)}`)
  }
  if (!Number.isInteger(bom.version) || bom.version < 1) issues.push("version must be an integer >= 1")

  const meta = bom.metadata
  if (typeof meta !== "object" || meta === null) {
    issues.push("metadata is required")
    return issues
  }
  if (typeof meta.timestamp !== "string" || Number.isNaN(Date.parse(meta.timestamp))) {
    issues.push("metadata.timestamp must be an ISO-8601 instant")
  }
  const tools: Record_[] = meta.tools?.components ?? []
  if (!tools.some((tool) => tool?.name === "kilo-sbom")) {
    issues.push("metadata.tools.components must record the generating tool")
  }

  const root = meta.component
  if (typeof root !== "object" || root === null) {
    issues.push("metadata.component is required")
    return issues
  }
  if (!root.name) issues.push("metadata.component.name is required")
  if (!root.version) issues.push("metadata.component.version is required")
  if (!root.type) issues.push("metadata.component.type is required")
  if (!root["bom-ref"]) issues.push("metadata.component.bom-ref is required")

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

  if (!Array.isArray(bom.components)) {
    issues.push("components must be an array")
    return issues
  }

  const refs = new Set<string>([root["bom-ref"]])
  for (const item of bom.components as Record_[]) {
    const name = item?.name ?? "<unnamed>"
    if (!item?.name) issues.push("every component requires a name")
    if (!item?.type) issues.push(`component ${name} requires a type`)
    if (!item?.["bom-ref"]) issues.push(`component ${name} requires a bom-ref`)
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

  if (!Array.isArray(bom.dependencies)) {
    issues.push("dependencies must be an array")
    return issues
  }
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

export function assertValid(bom: unknown, label: string) {
  const issues = validate(bom)
  if (issues.length) throw new Error(`${label} is not a valid Kilo SBOM:\n- ${issues.join("\n- ")}`)
}
