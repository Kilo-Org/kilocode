import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect } from "effect"

export type ApiKeyImport = {
  readonly kind: "api-key"
  readonly integrationID: string
  readonly key: string
  readonly metadata?: Readonly<Record<string, string>>
  readonly label: string
}

export type KiloOAuthImport = {
  readonly kind: "kilo-oauth"
  readonly integrationID: "kilo"
  readonly methodID: "device"
  readonly refresh: string
  readonly access: string
  readonly expires: number
  readonly server: string
  readonly organizationID: string | null
  readonly label: string
}

export type ProviderOAuthImport = {
  readonly kind: "oauth"
  readonly integrationID: "openai" | "github-copilot" | "xai"
  readonly methodID: "chatgpt-browser" | "device"
  readonly refresh: string
  readonly access: string
  readonly expires: number
  readonly metadata?: Readonly<Record<string, string>>
  readonly label: string
}

export type ImportCredential = ApiKeyImport | KiloOAuthImport | ProviderOAuthImport

/** Host-only writer. It must never be exposed through a client or RPC surface. */
export type CredentialWriter = (input: ImportCredential) => Promise<void>

export function createCredentialImporter(credentials: Pick<Credential.Interface, "create">): CredentialWriter {
  return (input) =>
    Effect.runPromise(
      credentials.create({
        integrationID: Integration.ID.make(input.integrationID),
        label: input.label,
        value:
          input.kind === "api-key"
            ? Credential.Key.make({
                type: "key",
                key: input.key,
                ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
              })
            : Credential.OAuth.make({
                type: "oauth",
                methodID: Integration.MethodID.make(input.methodID),
                refresh: input.refresh,
                access: input.access,
                expires: input.expires,
                metadata:
                  input.kind === "kilo-oauth"
                    ? { server: input.server, organizationID: input.organizationID }
                    : input.metadata,
              }),
      }),
    ).then(() => undefined)
}
