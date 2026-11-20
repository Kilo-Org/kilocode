import type { Credential } from "./nono-credentials"

export type PathKind = "literal" | "subtree"

export interface PathRule {
  readonly path: string
  readonly kind: PathKind
}

export interface FilesystemProfile {
  readonly allowWrite: ReadonlyArray<PathRule>
  readonly denyWrite: ReadonlyArray<PathRule>
  readonly denyNames: ReadonlyArray<string>
  readonly temporaryDirectory?: string | undefined
  /** Explicit read set. When absent, the write set is the read set. */
  readonly read?: ReadonlyArray<PathRule>
  /** Built-in credential locations to lift one deny for; granted from global config only. */
  readonly readExceptions?: ReadonlyArray<string>
}

export interface NetworkProfile {
  readonly mode: "allow" | "deny" | "proxy"
  readonly allowedHosts: ReadonlyArray<string>
}

export interface EnvironmentProfile {
  readonly deny: ReadonlyArray<string>
  readonly set: Readonly<Record<string, string>>
}

export interface Profile {
  readonly filesystem: FilesystemProfile
  readonly network: NetworkProfile
  readonly environment: EnvironmentProfile
  /** Credential routes. Definitions only: values stay in Kilo's environment and nono's supervisor. */
  readonly credentials?: ReadonlyArray<Credential>
}
