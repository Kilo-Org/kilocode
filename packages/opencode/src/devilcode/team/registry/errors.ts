export type TeamRegistryErrorKind = "signature_error" | "publisher_not_trusted" | "manifest_fetch_failed" | "manifest_invalid"

export class TeamRegistryError extends Error {
  readonly kind: TeamRegistryErrorKind
  constructor(kind: TeamRegistryErrorKind, message: string) {
    super(message)
    this.name = "TeamRegistryError"
    this.kind = kind
  }
}

export class TeamSignatureError extends TeamRegistryError {
  constructor(message = "Manifest signature verification failed") {
    super("signature_error", message)
    this.name = "TeamSignatureError"
  }
}

export class TeamPublisherNotTrusted extends TeamRegistryError {
  readonly publisherId: string
  constructor(publisherId: string, message?: string) {
    super("publisher_not_trusted", message ?? `Publisher "${publisherId}" is not in the trust store`)
    this.name = "TeamPublisherNotTrusted"
    this.publisherId = publisherId
  }
}

export class TeamManifestFetchFailed extends TeamRegistryError {
  readonly url: string
  readonly statusCode?: number
  constructor(opts: { url: string; message?: string; statusCode?: number }) {
    super("manifest_fetch_failed", opts.message ?? `Failed to fetch manifest from "${opts.url}"`)
    this.name = "TeamManifestFetchFailed"
    this.url = opts.url
    this.statusCode = opts.statusCode
  }
}

export class TeamManifestInvalid extends TeamRegistryError {
  readonly issues: string[]
  readonly source: string
  constructor(opts: { issues: string[]; source: string; message?: string }) {
    super("manifest_invalid", opts.message ?? `Manifest from "${opts.source}" failed validation`)
    this.name = "TeamManifestInvalid"
    this.issues = opts.issues
    this.source = opts.source
  }
}
