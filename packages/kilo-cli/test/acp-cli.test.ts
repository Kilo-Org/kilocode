import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { artifact, connect, fakeModel, initialize, newSession, ok } from "./acp-fixture"
import { fixture } from "./fixture"

const directory = path.resolve(import.meta.dir, "..")

test("kilo2 acp serves the protocol over stdio from its own isolated host", async () => {
  const built = await artifact()
  await using input = await fixture()
  const model = fakeModel("Preview CLI response")
  try {
    const config = path.join(input.env.XDG_CONFIG_HOME, "kilo2/interactive/kilo.jsonc")
    await mkdir(path.dirname(config), { recursive: true })
    await Bun.write(
      config,
      JSON.stringify({
        model: "fixture/chat",
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    )
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        "@opentui/solid/preload",
        path.join(directory, "src/tui-preview.ts"),
        "acp",
        "--directory",
        input.cwd,
      ],
      {
        cwd: directory,
        env: { ...input.env, KILO_ACP_ARTIFACT: built },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    const bridge = connect(child)
    try {
      const initialized = await initialize(bridge)
      expect(initialized.agentInfo?.name).toBe("Kilo")
      const session = await newSession(bridge, input.cwd)
      expect(session.sessionId).toStartWith("ses_")
      const listed = ok(await bridge.request<{ sessions: { sessionId: string }[] }>("session/list", { cwd: input.cwd }))
      expect(listed.sessions.some((entry) => entry.sessionId === session.sessionId)).toBe(true)
      const prompted = ok(
        await bridge.request<{ stopReason: string }>("session/prompt", {
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "Greet me" }],
        }),
      )
      expect(prompted.stopReason).toBe("end_turn")
      expect(model.requests.some((request) => request.stream)).toBe(true)

      // EOF owns the command: the bridge closes, then the host it launched.
      expect(await bridge.endStdin(), bridge.output().stderr).toBe(0)
    } finally {
      await bridge[Symbol.asyncDispose]()
    }
    const output = bridge.output()
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    // Protocol output stays machine-readable and carries no host credential.
    for (const line of output.stdout.split("\n").filter((line) => line.trim())) {
      expect(JSON.parse(line).jsonrpc).toBe("2.0")
    }
    expect(output.stdout).not.toContain(password)
    expect(output.stderr).not.toContain(password)
    expect(output.stdout).not.toContain("Basic ")
    expect(output.stdout).not.toContain("apiKey")

    // The command uses the isolated interactive profile and no stable storage.
    expect(existsSync(path.join(input.env.XDG_DATA_HOME, "kilo2/interactive/kilo2.db"))).toBe(true)
    for (const name of ["kilo", "opencode"]) {
      expect(existsSync(path.join(input.env.XDG_DATA_HOME, name))).toBe(false)
      expect(existsSync(path.join(input.env.XDG_CONFIG_HOME, name))).toBe(false)
      expect(existsSync(path.join(input.env.XDG_STATE_HOME, name))).toBe(false)
    }
  } finally {
    await model.stop()
  }
}, 180_000)
