import { expect, test } from "bun:test"
import type { InitializeResponse, ListSessionsResponse, NewSessionResponse } from "@agentclientprotocol/sdk"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { brandingPlugin } from "../src/branding/plugin"
import { hostMirrorsPlugin } from "../src/mirrors"

const repo = path.resolve(import.meta.dir, "../../..")
const entry = path.join(import.meta.dir, "fixtures/acp-wire.ts")

for (const hosted of [false, true]) {
  for (const compiled of [false, true]) {
    test(`${compiled ? "compiled" : "source"} ACP wire ${hosted ? "hosted" : "unhosted"}`, async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), "kilo-acp-wire-"))
      try {
        const outfile = path.join(root, process.platform === "win32" ? "acp.exe" : "acp")
        if (compiled) {
          const result = await Bun.build({
            entrypoints: [entry],
            plugins: hosted ? [hostMirrorsPlugin, brandingPlugin] : [],
            compile: { outfile, autoloadBunfig: false, autoloadDotenv: false },
            define: { KILO_BRANDING_COMPILED: "true" },
          })
          expect(result.success, result.logs.map(String).join("\n")).toBe(true)
        }
        const child = Bun.spawn(compiled ? [outfile] : [process.execPath, entry], {
          cwd: repo,
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(([key]) =>
                /^(PATH|LANG|LC_ALL|TZ|SystemRoot|WINDIR|PATHEXT)$/.test(key),
              ),
            ),
            BUN_OPTIONS: "",
            HOME: root,
            USERPROFILE: root,
            OPENCODE_TEST_HOME: root,
            XDG_CONFIG_HOME: path.join(root, "config"),
            XDG_DATA_HOME: path.join(root, "data"),
            XDG_STATE_HOME: path.join(root, "state"),
            XDG_CACHE_HOME: path.join(root, "cache"),
            TMPDIR: root,
            TEMP: root,
            TMP: root,
            KILO_ACP_TEST_HOSTED: hosted ? "1" : "0",
          },
          stdout: "pipe",
          stderr: "pipe",
          timeout: 30_000,
        })
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ])
        expect(code, stderr).toBe(0)
        const result = JSON.parse(stdout) as {
          plain: InitializeResponse
          terminal: InitializeResponse
          standard: InitializeResponse
          both: InitializeResponse
          auth: unknown
          invalidAuth: unknown
          session: NewSessionResponse
          list: ListSessionsResponse
          closed: unknown
          deleted: unknown
        }
        for (const response of [result.plain, result.terminal, result.standard, result.both]) {
          expect(response.protocolVersion).toBe(1)
          expect(response.agentCapabilities).toMatchObject({ loadSession: true, mcpCapabilities: { http: true } })
          expect(response.agentInfo?.name).toBe(hosted ? "Kilo" : "OpenCode")
          expect(response.authMethods?.[0]?.id).toBe("opencode-login")
        }
        expect(result.plain.authMethods?.[0]?._meta?.["terminal-auth"]).toBeUndefined()
        expect(result.standard.authMethods?.[0]?._meta?.["terminal-auth"]).toBeUndefined()
        for (const response of [result.terminal, result.both]) {
          expect(response.authMethods?.[0]?._meta?.["terminal-auth"]).toEqual({
            command: hosted ? "kilo2" : "opencode",
            args: ["auth", "login"],
            label: hosted ? "Kilo Login" : "OpenCode Login",
          })
        }
        for (const response of [result.standard, result.both]) {
          expect(response.authMethods?.[0]).toMatchObject({ type: "terminal", args: ["--login"] })
        }
        expect(result.auth).toEqual({})
        expect(result.invalidAuth).toMatchObject({ code: -32602, data: { methodId: "missing" } })
        expect(result.list.sessions.map((item) => item.sessionId)).toContain(result.session.sessionId)
        expect(result.closed).toEqual({})
        expect(result.deleted).toEqual({})
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }, 120_000)
  }
}
