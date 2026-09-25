/**
 * Kilo SBOM tooling.
 *
 * One place that knows how a Kilo SBOM is shaped, validated, and recorded, so
 * the CLI, VS Code, and JetBrains release paths produce interchangeable evidence
 * instead of three divergent formats.
 */

export * as Artifact from "./artifact"
export * as Deps from "./deps"
export * as Manifest from "./manifest"
export * as Policy from "./policy"
export * as Scan from "./scan"
export { compose, dedupe, ref, serial, serialize, timestamp, SPEC_VERSION, PROPERTY_NAMESPACE } from "./model"
export type { Bom, Build, Component, Compose, Delivery, Gap, Hash, Product, Subject, Target, Tool } from "./model"
export { assertValid, validate } from "./validate"
