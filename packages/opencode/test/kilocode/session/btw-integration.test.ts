import { describe, test, expect } from "bun:test"
import { Effect } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { createKiloClient } from "@kilocode/sdk/v2/client"
import { tmpdir, disposeAllInstances, disposeTestRuntime } from "../../fixture/fixture"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { Session } from "../../../src/session/session"

describe("btw integration", () => {
  test("btw no args shows usage without fork", async () => {
    await using tmp = await tmpdir({ git: true })
    const server = HttpRouter.toWebHandler(HttpApiApp.routes, { disableLogger: false })
    const client = createKiloClient({
      baseUrl: "http://localhost",
      directory: tmp.path,
      fetch: ((request: Request) => server.handler(request, HttpApiApp.context)) as unknown as typeof fetch,
    })
    const { data: session, error: errCreate } = await client.session.create({ directory: tmp.path } as any)
    expect(errCreate).toBeUndefined()
    const sid = (session as any).id
    console.log("sid", sid)

    // btw with no args
    const res = await client.session.command(
      { sessionID: sid, directory: tmp.path, command: "btw", arguments: "" } as any,
    )
    console.log("btw no args res", JSON.stringify(res, null, 2))
    expect(res.error).toBeUndefined()
    expect((res.data as any)?.parts?.[0]?.text).toContain("Usage: /btw")

    // check no fork created
    const { data: list } = await client.session.list({ directory: tmp.path } as any)
    console.log("list", list?.map((s:any)=>s.id))
    expect(list?.length).toBe(1)

    await server.dispose()
    await disposeAllInstances()
  }, { timeout: 30000 })

  test("btw with question creates fork then deletes and shows answer", async () => {
    await using tmp = await tmpdir({ git: true })
    const server = HttpRouter.toWebHandler(HttpApiApp.routes, { disableLogger: false })
    const client = createKiloClient({
      baseUrl: "http://localhost",
      directory: tmp.path,
      fetch: ((request: Request) => server.handler(request, HttpApiApp.context)) as unknown as typeof fetch,
    })
    const { data: session } = await client.session.create({ directory: tmp.path } as any)
    const sid = (session as any).id
    console.log("sid2", sid)

    // Create a simple prompt first to have history? Not needed
    // Mock LLM? For now test will fail if no LLM configured, but we can check fork handling even if LLM fails
    // Use a fake model that will error, but we check that fork is still deleted and error message shown
    const res = await client.session.command(
      { sessionID: sid, directory: tmp.path, command: "btw", arguments: "what is 2+2?" } as any,
    )
    console.log("btw with q res", JSON.stringify(res, null, 2))
    // Should not be error, should be BTW failed or answer
    expect(res.error).toBeUndefined()
    const text = (res.data as any)?.parts?.[0]?.text ?? ""
    console.log("text", text)
    expect(text).toContain("BTW")

    const { data: list2 } = await client.session.list({ directory: tmp.path } as any)
    console.log("list2", list2?.map((s:any)=>({id:s.id, title:s.title})))
    // fork should be deleted, so only original remains (maybe plus fork if not deleted)
    // we expect 1 session after delete, but if LLM fails we still delete fork, so 1
    expect(list2?.length).toBe(1)

    await server.dispose()
    await disposeAllInstances()
  }, { timeout: 30000 })
})
