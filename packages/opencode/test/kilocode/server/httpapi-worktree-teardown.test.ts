import { afterEach, describe, expect, test } from "bun:test"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ConfigProvider, Layer } from "effect"
import { HttpRouter } from "effect/unstable/http"
import { mkdir, symlink } from "fs/promises"
import path from "path"
import { ServerAuth } from "../../../src/server/auth"
import { HttpApiApp } from "../../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../../fixture/db"
import { disposeAllInstances, tmpdir } from "../../fixture/fixture"

const original = {
  password: Flag.KILO_SERVER_PASSWORD,
  username: Flag.KILO_SERVER_USERNAME,
  envPassword: process.env.KILO_SERVER_PASSWORD,
  envUsername: process.env.KILO_SERVER_USERNAME,
}

afterEach(async () => {
  Flag.KILO_SERVER_PASSWORD = original.password
  Flag.KILO_SERVER_USERNAME = original.username
  if (original.envPassword === undefined) delete process.env.KILO_SERVER_PASSWORD
  else process.env.KILO_SERVER_PASSWORD = original.envPassword
  if (original.envUsername === undefined) delete process.env.KILO_SERVER_USERNAME
  else process.env.KILO_SERVER_USERNAME = original.envUsername
  await disposeAllInstances()
  await resetDatabase()
})

function app(input: { password?: string; username?: string }) {
  const handler = HttpRouter.toWebHandler(
    HttpApiApp.routes.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            KILO_SERVER_PASSWORD: input.password,
            KILO_SERVER_USERNAME: input.username,
            KILO_EXPERIMENTAL_DISABLE_FILEWATCHER: process.env.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER ?? "true",
          }),
        ),
      ),
    ),
    { disableLogger: true },
  ).handler

  return {
    request(input: string | URL | Request, init?: RequestInit) {
      return handler(
        input instanceof Request ? input : new Request(new URL(input, "http://localhost"), init),
        HttpApiApp.context,
      )
    },
  }
}

function setAuth(password: string) {
  Flag.KILO_SERVER_PASSWORD = password
  Flag.KILO_SERVER_USERNAME = undefined
  process.env.KILO_SERVER_PASSWORD = password
  delete process.env.KILO_SERVER_USERNAME
}

describe("POST /kilocode/worktree/teardown", () => {
  test("requires auth, rejects paths outside the managed directory, and only disposes loaded instances", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const worktree = path.join(tmp.path, ".kilo", "worktrees", "teardown")
    await mkdir(worktree, { recursive: true })
    const route = (directory: string) => `/kilocode/worktree/teardown?directory=${encodeURIComponent(directory)}`
    const init = (body: unknown, authorization?: string): RequestInit => ({
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-kilo-directory": tmp.path,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    })

    const unsecured = await app({}).request(route(tmp.path), init({ worktree }))
    expect(unsecured.status).toBe(401)

    setAuth("secret")
    const secured = app({ password: "secret" })
    const auth = ServerAuth.header({ username: "kilo", password: "secret" }) ?? ""

    const outside = await secured.request(route(tmp.path), init({ worktree: tmp.path }, auth))
    expect(outside.status).toBe(400)
    const nested = await secured.request(route(tmp.path), init({ worktree: path.join(worktree, "sub") }, auth))
    expect(nested.status).toBe(400)
    const escape = await secured.request(
      route(tmp.path),
      init({ worktree: path.join(tmp.path, ".kilo", "worktrees", "..", "..") }, auth),
    )
    expect(escape.status).toBe(400)
    // A symlinked entry would let disposeDirectory reach an instance outside the project.
    await symlink(tmp.path, path.join(tmp.path, ".kilo", "worktrees", "linked"), "dir")
    const linked = await secured.request(
      route(tmp.path),
      init({ worktree: path.join(tmp.path, ".kilo", "worktrees", "linked") }, auth),
    )
    expect(linked.status).toBe(400)

    // The worktree instance was never loaded, so teardown must not boot one.
    const cold = await secured.request(route(tmp.path), init({ worktree }, auth))
    expect(cold.status).toBe(200)
    expect(await cold.json()).toEqual({ disposed: false })

    // Any directory-scoped request loads the worktree instance; teardown then disposes it.
    const load = await secured.request(`/path?directory=${encodeURIComponent(worktree)}`, {
      headers: { authorization: auth, "x-kilo-directory": worktree },
    })
    expect(load.status).toBe(200)
    const warm = await secured.request(route(tmp.path), init({ worktree }, auth))
    expect(warm.status).toBe(200)
    expect(await warm.json()).toEqual({ disposed: true })
    const again = await secured.request(route(tmp.path), init({ worktree }, auth))
    expect(await again.json()).toEqual({ disposed: false })
  })
})
