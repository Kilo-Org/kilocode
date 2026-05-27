import { $ } from "bun"
import { afterEach, describe, expect, test } from "bun:test"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { IngestQueue } from "../../../src/kilo-sessions/ingest-queue"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { Session } from "../../../src/session/session"
import { Storage } from "../../../src/storage/storage"
import { provideTestInstance, tmpdir } from "../../fixture/fixture"
import { resetDatabase } from "../../fixture/db"

type Payload = { data: IngestQueue.Data[] }

const env = {
  auth: process.env["KILO_AUTH_CONTENT"],
  ingest: process.env["KILO_SESSION_INGEST_URL"],
}
const fetch = globalThis.fetch
const token = "kilo-meta-test-token"

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
    return
  }
  process.env[key] = value
}

function timeout<T>(task: Promise<T>) {
  return Promise.race([
    task,
    Bun.sleep(5_000).then(() => {
      throw new Error("timed out waiting for Kilo Sessions ingest payload")
    }),
  ])
}

afterEach(async () => {
  globalThis.fetch = fetch
  restore("KILO_AUTH_CONTENT", env.auth)
  restore("KILO_SESSION_INGEST_URL", env.ingest)
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache(`kilo-sessions:token-valid:${token}`)
  clearInFlightCache("kilo-sessions:client")
  clearInFlightCache("kilo-sessions:org")
  await resetDatabase()
})

describe("KiloSessions kilo_meta", () => {
  test("includes the active git branch", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git branch -M feature/meta`.cwd(tmp.path).quiet()

    const base = "https://ingest.test"
    process.env["KILO_AUTH_CONTENT"] = JSON.stringify({ kilo: { type: "api", key: token } })
    process.env["KILO_SESSION_INGEST_URL"] = base
    clearInFlightCache("kilo-sessions:token")
    clearInFlightCache(`kilo-sessions:token-valid:${token}`)
    clearInFlightCache("kilo-sessions:client")

    const sent = Promise.withResolvers<Payload>()
    globalThis.fetch = (async (input, init) => {
      const url = String(input)
      if (url.endsWith("/api/user")) return new Response(null, { status: 200 })
      if (url === `${base}/ingest?v=1`) {
        if (typeof init?.body !== "string") throw new Error("expected ingest body")
        sent.resolve(JSON.parse(init.body) as Payload)
        return new Response(null, { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }) as typeof fetch

    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "initial" })
        await Storage.write(["session_share", session.id], { id: session.id, ingestPath: "/ingest" })
        await KiloSessions.init()
        await Session.setTitle({ sessionID: session.id, title: "updated" })

        const payload = await timeout(sent.promise)
        const meta = payload.data.find((item) => item.type === "kilo_meta")
        expect(meta?.type).toBe("kilo_meta")
        if (meta?.type !== "kilo_meta") throw new Error("missing kilo_meta payload")
        expect(meta.data.gitBranch).toBe("feature/meta")
      },
    })
  })
})
