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
}
