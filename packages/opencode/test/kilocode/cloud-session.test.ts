import { describe, expect, test, mock } from "bun:test"
import { importCloudSession, reportCloudImportError } from "../../src/kilocode/cloud-session"

const errorMock = mock()
mock.module("@/cli/ui", () => ({ UI: { error: errorMock } }))

type ImportResult = { data?: unknown; error?: unknown }

const client = (imp: (params: { sessionId: string }) => Promise<ImportResult>) =>
  ({ kilo: { cloud: { session: { import: imp } } } }) as Parameters<typeof importCloudSession>[0]

describe("importCloudSession", () => {
  test("returns local id on success", async () => {
    const c = client(async () => ({ data: { id: "ses_local" } }))
    const id = await importCloudSession(c, "ses_cloud")
    expect(id).toBe("ses_local")
  })

  test("throws when server returns HTTP error", async () => {
    const c = client(async () => ({
      data: undefined,
      error: { name: "GatewayError", message: "session not found", status: 404 },
    }))
    await expect(importCloudSession(c, "ses_cloud")).rejects.toThrow("session not found")
  })

  test("throws when data.id is missing", async () => {
    const c = client(async () => ({ data: {} }))
    await expect(importCloudSession(c, "ses_cloud")).rejects.toThrow()
  })

  test("propagates thrown fetch exceptions", async () => {
    const c = client(async () => {
      throw new Error("network down")
    })
    await expect(importCloudSession(c, "ses_cloud")).rejects.toThrow("network down")
  })
})

describe("reportCloudImportError", () => {
  test("surfaces the reason via UI.error and does not throw", () => {
    const err = new Error("session not found")
    expect(() => reportCloudImportError(err)).not.toThrow()
    expect(errorMock).toHaveBeenCalledWith("Failed to import session from cloud: session not found")
  })
})
