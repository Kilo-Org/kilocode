import { afterEach, describe, expect, test } from "bun:test"
import type { Hooks } from "@kilocode/plugin"
import { OAUTH_DUMMY_KEY } from "../../../src/auth"
import { createAzureAuthHooks } from "../../../src/plugin/azure"

const keys = ["AZURE_RESOURCE_NAME", "AZURE_OPENAI_RESOURCE_NAME", "AZURE_OPENAI_ENDPOINT"] as const
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]))

function clearEnv() {
  for (const key of keys) delete process.env[key]
}

afterEach(() => {
  for (const key of keys) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

function oauthMethod(hooks: Hooks) {
  const method = hooks.auth?.methods.find((item) => item.type === "oauth")
  if (!method || method.type !== "oauth") throw new Error("Azure OAuth method is missing")
  return method
}

function shell(scopes: string[]) {
  return async (args: string[]) => {
    scopes.push(args[args.indexOf("--scope") + 1])
    return { accessToken: "test-token", expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000) }
  }
}

async function callback(hooks: Hooks, inputs?: Record<string, string>) {
  const authorization = await oauthMethod(hooks).authorize(inputs)
  if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")
  return authorization.callback()
}

describe("azure Entra endpoint resolution", () => {
  test("stores a full endpoint URL from Entra ID prompts", async () => {
    clearEnv()
    const scopes: string[] = []
    const hooks = createAzureAuthHooks(shell(scopes), fetch, true)

    expect(await callback(hooks, { baseURL: "https://custom.openai.azure.com/openai" })).toMatchObject({
      type: "success",
      access: OAUTH_DUMMY_KEY,
      refresh: OAUTH_DUMMY_KEY,
      baseURL: "https://custom.openai.azure.com/openai",
    })
    expect(scopes).toEqual(["https://cognitiveservices.azure.com/.default"])
  })

  test("stores a resource name from Entra ID prompts", async () => {
    clearEnv()
    const hooks = createAzureAuthHooks(shell([]), fetch, true)

    expect(await callback(hooks, { resourceName: "dialog-resource" })).toMatchObject({
      type: "success",
      accountId: "dialog-resource",
    })
  })

  test("resolves the resource name from AZURE_OPENAI_RESOURCE_NAME", async () => {
    clearEnv()
    process.env.AZURE_OPENAI_RESOURCE_NAME = "env-resource"
    const hooks = createAzureAuthHooks(shell([]), fetch, true)

    expect(await callback(hooks)).toMatchObject({ type: "success", accountId: "env-resource" })
  })

  test("resolves the endpoint from AZURE_OPENAI_ENDPOINT", async () => {
    clearEnv()
    process.env.AZURE_OPENAI_ENDPOINT = "https://env.openai.azure.com/openai"
    const hooks = createAzureAuthHooks(shell([]), fetch, true)

    expect(await callback(hooks)).toMatchObject({
      type: "success",
      baseURL: "https://env.openai.azure.com/openai",
    })
  })

  test("requires a resource name or endpoint for Entra ID", async () => {
    clearEnv()
    const hooks = createAzureAuthHooks(shell([]), fetch, true)

    await expect(callback(hooks)).rejects.toThrow("Azure Resource Name or endpoint URL is required")
  })

  test("hides endpoint prompts when Azure env vars are already set", () => {
    clearEnv()
    process.env.AZURE_OPENAI_RESOURCE_NAME = "env-resource"
    const hooks = createAzureAuthHooks(shell([]), fetch, true)

    expect(hooks.auth?.methods.map((method) => method.prompts)).toEqual([[], []])
  })
})
