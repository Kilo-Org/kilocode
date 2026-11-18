import { expect, test } from "bun:test"
import { $ } from "bun"
import { createRoutes } from "@opencode/server/routes"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"

async function eventually<A>(read: () => Promise<A>, ready: (value: A) => boolean) {
  const deadline = performance.now() + 20_000
  while (performance.now() < deadline) {
    const value = await read()
    if (ready(value)) return value
    await Bun.sleep(20)
  }
  throw new Error("The git plugin did not activate")
}

// A repository whose package exports a server entry, cloned by the host when it loads the configured plugin.
async function repository() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-git-plugin-repo-")))
  await $`git init -q -b main`.cwd(directory).quiet()
  await $`git config user.email test@example.com`.cwd(directory).quiet()
  await $`git config user.name Test`.cwd(directory).quiet()
  await $`git config commit.gpgsign false`.cwd(directory).quiet()
  await Bun.write(
    path.join(directory, "package.json"),
    JSON.stringify({ name: "git-plugin", exports: { "./server": "./server.ts" } }),
  )
  await Bun.write(path.join(directory, "server.ts"), 'export default { id: "git-plugin", async setup() {} }\n')
  await $`git add -A`.cwd(directory).quiet()
  await $`git commit -q -m plugin`.cwd(directory).quiet()
  return directory
}

test("a git: plugin in kilo2.json clones and loads through the Kilo host", async () => {
  const repositoryDirectory = await repository()
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-git-plugin-project-")))
  const spec = `git:${repositoryDirectory}`
  try {
    await Bun.write(path.join(directory, "kilo2.json"), JSON.stringify({ plugins: [spec] }))
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory: path.join(directory, "global"), project: true },
              },
              () => [],
              KiloHost.overrides,
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const read = async () => {
            const url = new URL("/api/plugin", "http://kilo.local")
            url.searchParams.set("location[directory]", directory)
            const response = await handler(
              new Request(url, { headers: { authorization: `Basic ${btoa("opencode:secret")}` } }),
            )
            const body = (await response.json()) as { data: { id?: string }[] }
            return { status: response.status, body }
          }
          const listed = yield* Effect.promise(() =>
            eventually(read, (result) => result.body.data.some((plugin) => plugin.id === "git-plugin")),
          )
          expect(listed.body.data).toContainEqual(
            expect.objectContaining({
              id: "git-plugin",
              source: { type: "package", target: spec },
              state: { status: "active" },
            }),
          )
        }),
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(repositoryDirectory, { recursive: true, force: true })
  }
})
