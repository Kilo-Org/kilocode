import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { ConfigProvider, Effect, Layer, Option } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { ServerAuth } from "../../../src/server/auth"
import { ServerPassword } from "../../../src/kilocode/server/password"
import { tmpdir } from "../../fixture/fixture"

const original = Flag.KILO_SERVER_PASSWORD

afterEach(() => {
  Flag.KILO_SERVER_PASSWORD = original
  ServerPassword.reset()
})

async function write(text: string) {
  const tmp = await tmpdir()
  const file = path.join(tmp.path, "password")
  await Bun.write(file, text)
  return { tmp, file }
}

function config(env: Record<string, string>) {
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* ServerAuth.Config
    }).pipe(
      Effect.provide(
        ServerAuth.Config.layer.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))),
      ),
    ),
  )
}

describe("ServerPassword", () => {
  test("does nothing without KILO_SERVER_PASSWORD_FILE", async () => {
    Flag.KILO_SERVER_PASSWORD = undefined

    expect(await ServerPassword.load({})).toBeUndefined()
    expect(ServerPassword.get()).toBeUndefined()
    expect(Flag.KILO_SERVER_PASSWORD).toBeUndefined()
  })

  test("reads the password and strips one trailing newline", async () => {
    const input = await write("secret\n\n")
    await using _ = input.tmp

    expect(await ServerPassword.load({ KILO_SERVER_PASSWORD_FILE: input.file })).toBeUndefined()
    expect(ServerPassword.get()).toBe("secret\n")
    expect(Flag.KILO_SERVER_PASSWORD).toBe("secret\n")
  })

  test("strips a trailing CRLF", async () => {
    const input = await write("secret\r\n")
    await using _ = input.tmp

    expect(await ServerPassword.load({ KILO_SERVER_PASSWORD_FILE: input.file })).toBeUndefined()
    expect(ServerPassword.get()).toBe("secret")
  })

  test("keeps KILO_SERVER_PASSWORD when both are set", async () => {
    Flag.KILO_SERVER_PASSWORD = "env-secret"
    const input = await write("file-secret")
    await using _ = input.tmp

    expect(
      await ServerPassword.load({ KILO_SERVER_PASSWORD: "env-secret", KILO_SERVER_PASSWORD_FILE: input.file }),
    ).toBeUndefined()
    expect(ServerPassword.get()).toBeUndefined()
    expect(Flag.KILO_SERVER_PASSWORD).toBe("env-secret")
  })

  test("reports an empty file", async () => {
    Flag.KILO_SERVER_PASSWORD = undefined
    const input = await write("\n")
    await using _ = input.tmp

    expect(await ServerPassword.load({ KILO_SERVER_PASSWORD_FILE: input.file })).toBe(
      `KILO_SERVER_PASSWORD_FILE (${input.file}) is empty`,
    )
    expect(ServerPassword.get()).toBeUndefined()
    expect(Flag.KILO_SERVER_PASSWORD).toBeUndefined()
  })

  test("reports an unreadable file", async () => {
    Flag.KILO_SERVER_PASSWORD = undefined
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "missing")

    const err = await ServerPassword.load({ KILO_SERVER_PASSWORD_FILE: file })
    expect(err).toStartWith(`Could not read KILO_SERVER_PASSWORD_FILE (${file}): `)
    expect(err).toContain("ENOENT")
    expect(Flag.KILO_SERVER_PASSWORD).toBeUndefined()
  })

  test("feeds the loaded password into the server auth config", async () => {
    const input = await write("secret\n")
    await using _ = input.tmp

    expect(Option.isNone((await config({})).password)).toBe(true)

    await ServerPassword.load({ KILO_SERVER_PASSWORD_FILE: input.file })
    const cfg = await config({ KILO_SERVER_PASSWORD: "" })

    expect(cfg.password).toEqual(Option.some("secret"))
    expect(ServerAuth.required(cfg)).toBe(true)
    expect(ServerAuth.headers()).toEqual({
      Authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}`,
    })
  })
})
