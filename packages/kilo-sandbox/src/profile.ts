export type PathKind = "literal" | "subtree"

export interface PathRule {
  readonly path: string
  readonly kind: PathKind
}

export interface FilesystemProfile {
  readonly allowWrite: ReadonlyArray<PathRule>
  readonly denyWrite: ReadonlyArray<PathRule>
  readonly denyNames: ReadonlyArray<string>
  /**
   * When present, ambient reads are confined to these paths (minus {@link denyRead} and
   * {@link denyNames}). When absent the process reads whatever the user can, which is the behaviour
   * every ordinary Kilo session keeps: the file-level sandbox exists to contain writes and network,
   * and narrowing reads for a whole session would break far more than it protects.
   *
   * Paths are matched after the operating system resolves them, so a symlink out of an allowed
   * subtree does not become readable.
   */
  readonly allowRead?: ReadonlyArray<PathRule> | undefined
  /** Paths that stay unreadable even when {@link allowRead} would otherwise cover them. */
  readonly denyRead?: ReadonlyArray<PathRule> | undefined
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
