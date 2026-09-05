import { expect, test } from "bun:test"
import { Credential } from "@opencode-ai/core/credential"
import { Integration } from "@opencode-ai/schema/integration"
import { Effect } from "effect"
import { createCredentialImporter, type ImportCredential } from "../src/credential-import"

test("writes metadata API keys and proven OAuth through the core credential constructor", async () => {
  const created: Array<Parameters<Credential.Interface["create"]>[0]> = []
  const writer = createCredentialImporter({
    create: (input) =>
      Effect.sync(() => {
        created.push(input)
        return new Credential.Info({
          id: Credential.ID.create(),
          integrationID: input.integrationID,
          label: input.label ?? "default",
          value: input.value,
        })
      }),
  })
  const inputs: ImportCredential[] = [
    {
      kind: "api-key",
      integrationID: "anthropic",
      key: "fixture-key",
      metadata: { region: "us-east-1" },
      label: "Imported from v1",
    },
    {
      kind: "kilo-oauth",
      integrationID: "kilo",
      methodID: "device",
      refresh: "refresh-fixture",
      access: "access-fixture",
      expires: 1_000,
      server: "http://127.0.0.1:4010",
      organizationID: null,
      label: "Imported from v1",
    },
    {
      kind: "oauth",
      integrationID: "openai",
      methodID: "chatgpt-browser",
      refresh: "openai-refresh",
      access: "openai-access",
      expires: 2_000,
      metadata: { accountID: "acct_123" },
      label: "Imported from v1",
    },
    {
      kind: "oauth",
      integrationID: "github-copilot",
      methodID: "device",
      refresh: "copilot-refresh",
      access: "copilot-access",
      expires: 3_000,
      metadata: { enterpriseUrl: "enterprise.example" },
      label: "Imported from v1",
    },
    {
      kind: "oauth",
      integrationID: "xai",
      methodID: "device",
      refresh: "xai-refresh",
      access: "xai-access",
      expires: 4_000,
      label: "Imported from v1",
    },
  ]

  await Promise.all(inputs.map(writer))

  expect(created).toHaveLength(5)
  expect(created[0]?.value).toEqual({ type: "key", key: "fixture-key", metadata: { region: "us-east-1" } })
  expect(created[1]?.integrationID).toBe(Integration.ID.make("kilo"))
  expect(created[1]?.value).toEqual({
    type: "oauth",
    methodID: Integration.MethodID.make("device"),
    refresh: "refresh-fixture",
    access: "access-fixture",
    expires: 1_000,
    metadata: { server: "http://127.0.0.1:4010", organizationID: null },
  })
  expect(created.slice(2).map((credential) => credential.value)).toEqual([
    {
      type: "oauth",
      methodID: Integration.MethodID.make("chatgpt-browser"),
      refresh: "openai-refresh",
      access: "openai-access",
      expires: 2_000,
      metadata: { accountID: "acct_123" },
    },
    {
      type: "oauth",
      methodID: Integration.MethodID.make("device"),
      refresh: "copilot-refresh",
      access: "copilot-access",
      expires: 3_000,
      metadata: { enterpriseUrl: "enterprise.example" },
    },
    {
      type: "oauth",
      methodID: Integration.MethodID.make("device"),
      refresh: "xai-refresh",
      access: "xai-access",
      expires: 4_000,
    },
  ])
})
