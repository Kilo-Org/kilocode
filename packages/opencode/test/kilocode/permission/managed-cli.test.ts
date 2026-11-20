import { expect, test } from "bun:test"
import { mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { Effect, Fiber } from "effect"
import z from "zod"
import producer from "../../../../kilo-gateway/test/fixtures/permission-policy-v1.json"
import { cliIt, testModelID, type CliFixture } from "../../lib/cli-process"
import { pollWithTimeout } from "../../lib/effect"
import { testProviderConfig } from "../../lib/test-provider"

const bash = process.platform === "win32" ? (Bun.which("bash") ?? "bash") : "/bin/bash"
const pwsh = process.env.KILO_TEST_PWSH || Bun.which("pwsh")
const organization = producer.enabled_empty.organization_id
const revision = producer.layered.revision
const etag = producer.conditional.etag
const token = "managed-permission-cli-fixture"
const route = `/api/organizations/${organization}/policy/permission`
const profile = "/api/profile"
const bear = `Bearer ${token}`
const timeout = 90_000

type Action = "allow" | "ask" | "deny"
type Layer = {
  unrestricted_mode?: "allow" | "deny"
  shell?: Partial<
    Record<"bash" | "powershell", { fallback: "ask" | "deny"; rules: { pattern: string; action: Action }[] }>
  >
  tools?: Record<string, Action>
}

// The base envelope and opaque validator come from Cloud merge 946127976b0146dd8e77b430884253d728541f80.
const cloud = Effect.fn(function* (layers: Layer[], age = producer.enabled_empty.max_age_seconds) {
  const hits: { pathname: string; authorization: string | null; conditional: string | null }[] = []
  const envelope = (layers: Layer[], revision: number, age: number) => ({
    ...producer.enabled_empty,
    revision,
    max_age_seconds: age,
    policy: {
      agent_permissions: { layers: layers.map((layer) => ({ schema_version: 1, ...layer })) },
      client_access: { layers: [{ schema_version: 1, mode: "allowlist", clients: [{ feature: "cli" }] }] },
    },
  })
  let current = { body: envelope(layers, revision, age), etag }
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req) {
          const pathname = new URL(req.url).pathname
          if (req.method !== "GET" || (pathname !== profile && pathname !== route)) {
            return new Response(null, { status: 404 })
          }
          const authorization = req.headers.get("authorization")
          const conditional = req.headers.get("if-none-match")
          hits.push({ pathname, authorization, conditional })
          if (authorization !== bear) return new Response(null, { status: 401 })
          if (pathname === profile) return Response.json({ user: { id: "oauth/permission-cli-member" } })
          const headers = { etag: current.etag }
          if (conditional === current.etag) return new Response(null, { status: 304, headers })
          return Response.json(current.body, { headers })
        },
      }),
    ),
    (server) => Effect.promise(() => server.stop(true)),
  )
  return {
    url: server.url.origin,
    verify() {
      expect(hits).toContainEqual({ pathname: profile, authorization: bear, conditional: null })
      expect(hits).toContainEqual({ pathname: route, authorization: bear, conditional: null })
    },
    refresh(layers: Layer[]) {
      current = {
        body: envelope(layers, revision + 1, producer.enabled_empty.max_age_seconds),
        etag: '"changed-policy"',
      }
    },
    hits,
  }
})

function environment({ home, llm }: CliFixture, url: string, shell: string, rules: Record<string, Action> = {}) {
  return {
    PWD: home,
    KILO_API_URL: url,
    KILO_API_KEY: token,
    KILO_ORG_ID: organization,
    KILOCODE_FEATURE: "cli",
    KILO_CONFIG: "",
    KILO_CONFIG_DIR: "",
    KILO_DB: ":memory:",
    KILO_SERVER_PASSWORD: "",
    KILO_TELEMETRY_LEVEL: "off",
    KILO_NO_DAEMON: "1",
    KILO_TEST_MANAGED_CONFIG_DIR: path.join(home, "device-config"),
    KILO_PERMISSION: JSON.stringify({ bash: { "*": "allow", ...rules }, external_directory: "allow", edit: "allow" }),
    KILO_CONFIG_CONTENT: JSON.stringify({
      ...testProviderConfig(llm.url),
      enabled_providers: ["test"],
      model: testModelID,
      small_model: testModelID,
      shell,
      share: "disabled",
      snapshot: false,
      sandbox: { enabled: false },
      agent: { title: { disable: true } },
    }),
  }
}

function api(base: string, dir: string, password?: string) {
  return (route: string, body?: object) =>
    Effect.tryPromise({
      try: async (signal) => {
        const url = new URL(route, base)
        url.searchParams.set("directory", dir)
        const headers = new Headers()
        if (password) headers.set("authorization", `Basic ${btoa(`kilo:${password}`)}`)
        if (body !== undefined) headers.set("content-type", "application/json")
        const res = await fetch(url, {
          headers,
          signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]),
          ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
        })
        const text = await res.text()
        if (!res.ok) throw new Error(`CLI HTTP ${route}: ${res.status} ${text}`)
        const data: unknown = JSON.parse(text)
        return data
      },
      catch: (err) => err,
    })
}

function shell(command: string, workdir?: string) {
  return { command, description: "Exercise managed shell permissions", ...(workdir ? { workdir } : {}) }
}

const script = Effect.fn(function* ({ llm }: CliFixture, tool: string, input: object) {
  yield* llm.reset
  yield* llm.tool(tool, input)
  yield* llm.text("Finished the fixture turn.")
})

const prompt = Effect.fn(function* (
  fixture: CliFixture,
  request: ReturnType<typeof api>,
  tool: string,
  input: object,
  session?: string,
) {
  const id =
    session ?? z.object({ id: z.string() }).parse(yield* request("/session", { title: "Managed CLI fixture" })).id
  yield* script(fixture, tool, input)
  const route = `/session/${id}/message`
  return {
    id,
    send: request(route, { agent: "code", parts: [{ type: "text", text: "Run the scripted operation." }] }),
    parts: request(route).pipe(
      Effect.map((data) =>
        z
          .array(z.object({ parts: z.array(z.looseObject({ type: z.string() })) }))
          .parse(data)
          .flatMap((message) => message.parts.filter((part) => part.type === "tool")),
      ),
    ),
  }
})

const run = Effect.fn(function* (fixture: CliFixture, env: Record<string, string>, command: string) {
  yield* script(fixture, "bash", shell(command))
  const result = yield* fixture.opencode.run("Run the scripted operation.", {
    env,
    agent: "code",
    format: "json",
    extraArgs: ["--auto", "--title", "Managed CLI fixture", "--dir", fixture.home],
  })
  const event = fixture.opencode.parseJsonEvents(result.stdout).find((event) => event.type === "tool_use")
  if (!event) throw new Error(`No terminal shell event (exit ${result.exitCode})\n${result.stderr}\n${result.stdout}`)
  return { part: event.part, result }
})

function denied(part: unknown, tool: string, input: object, error = /permission|policy|prevents you from using/i) {
  expect(part, `${tool} ${JSON.stringify(input)}`).toMatchObject({
    tool,
    state: { input, status: "error", error: expect.stringMatching(error) },
  })
}

cliIt.live(
  "applies independent organization, editable, device, external-directory, and tool rules to real Bash operations",
  (fixture) =>
    Effect.gen(function* () {
      const org = yield* cloud([
        {
          shell: {
            bash: {
              fallback: "deny",
              rules: [
                { pattern: "type *", action: "allow" },
                { pattern: "printf *", action: "allow" },
                { pattern: "touch *", action: "allow" },
                { pattern: "touch org-denied.txt", action: "deny" },
              ],
            },
          },
        },
        { unrestricted_mode: "deny", tools: { external_directory: "deny", edit: "deny", task: "deny" } },
      ])
      const home = yield* Effect.promise(() => realpath(fixture.home))
      const dir = path.join(home, "project")
      const outside = path.join(home, "outside")
      yield* Effect.promise(() => Promise.all([mkdir(dir), mkdir(outside)]))
      const env = environment(fixture, org.url, bash, {
        "touch local-denied.txt": "deny",
        "touch device-denied.txt": "allow",
      })
      yield* Effect.promise(() =>
        Bun.write(
          path.join(env.KILO_TEST_MANAGED_CONFIG_DIR, "kilo.json"),
          JSON.stringify({ permission: { bash: { "touch device-denied.txt": "deny" } } }),
        ),
      )
      const password = "fixture-cli-password"
      const server = yield* fixture.opencode.serve({
        env: { ...env, KILO_SERVER_USERNAME: "kilo", KILO_SERVER_PASSWORD: password },
        readyTimeoutMs: 30_000,
      })
      const request = api(server.url, dir, password)
      expect(yield* request("/permission/allow-everything", { enable: true })).toBe(false)
      expect(yield* request("/permission/allow-everything", { enable: false })).toBe(true)
      const task = {
        description: "Run a fixture subtask",
        prompt: "Respond with fixture text.",
        subagent_type: "general",
      }
      const child = yield* prompt(fixture, request, "task", task)
      yield* child.send
      denied((yield* child.parts).at(-1), "task", task, /does not allow task/i)
      const allowed = yield* prompt(fixture, request, "bash", shell("type -t shopt"))
      yield* allowed.send
      expect((yield* allowed.parts).at(-1)).toMatchObject({
        tool: "bash",
        state: { status: "completed", output: expect.stringMatching(/\bbuiltin\b/) },
      })
      const cases = [
        { tool: "bash", input: shell("touch org-denied.txt"), file: path.join(dir, "org-denied.txt") },
        { tool: "bash", input: shell("touch local-denied.txt"), file: path.join(dir, "local-denied.txt") },
        { tool: "bash", input: shell("touch device-denied.txt"), file: path.join(dir, "device-denied.txt") },
        {
          tool: "bash",
          input: shell("touch external-denied.txt", outside),
          file: path.join(outside, "external-denied.txt"),
          error: /does not allow external_directory/i,
        },
        {
          tool: "bash",
          input: shell('touch "$(printf uncertain-denied.txt)"'),
          file: path.join(dir, "uncertain-denied.txt"),
        },
        {
          tool: "write",
          input: { filePath: path.join(dir, "edit-denied.txt"), content: "fixture\n" },
          file: path.join(dir, "edit-denied.txt"),
          error: /does not allow edit/i,
        },
      ]
      for (const item of cases) {
        const attempt = yield* prompt(fixture, request, item.tool, item.input)
        yield* attempt.send
        denied((yield* attempt.parts).at(-1), item.tool, item.input, item.error)
        expect(yield* Effect.promise(() => Bun.file(item.file).exists())).toBe(false)
      }
      org.verify()
    }),
  timeout,
)

const powershell =
  "runs real PowerShell with an omitted shell layer but denies an explicitly missing PowerShell profile"
if (!pwsh) test.skip(`${powershell} (install pwsh or set KILO_TEST_PWSH)`, () => {})
if (pwsh) {
  cliIt.live(
    powershell,
    (fixture) =>
      Effect.gen(function* () {
        const policy: Layer = {
          shell: {
            powershell: {
              fallback: "deny",
              rules: [
                { pattern: "Write-Output *", action: "allow" },
                { pattern: "Set-Content *", action: "allow" },
              ],
            },
          },
        }
        const omitted = yield* cloud([policy, { tools: { edit: "deny" } }])
        const allowed = yield* run(
          fixture,
          environment(fixture, omitted.url, pwsh),
          "Write-Output 'POWERSHELL_EXECUTED'",
        )
        fixture.opencode.expectExit(allowed.result, 0)
        expect(allowed.part).toMatchObject({
          tool: "bash",
          state: { status: "completed", output: expect.stringContaining("POWERSHELL_EXECUTED") },
        })
        omitted.verify()

        const missing = yield* cloud([policy, { shell: { bash: { fallback: "ask", rules: [] } } }])
        const command = "Set-Content -Path powershell-denied.txt -Value fixture"
        const attempt = yield* run(fixture, environment(fixture, missing.url, pwsh), command)
        denied(attempt.part, "bash", { command })
        expect(yield* Effect.promise(() => Bun.file(path.join(fixture.home, "powershell-denied.txt")).exists())).toBe(
          false,
        )
        missing.verify()
      }),
    timeout,
  )
}

cliIt.live(
  "kilo run --auto rejects asks from a tool-only policy without executing the command",
  (fixture) =>
    Effect.gen(function* () {
      const org = yield* cloud([{ tools: { bash: "ask" } }])
      const command = "touch headless-denied.txt"
      const attempt = yield* run(fixture, environment(fixture, org.url, bash), command)
      denied(attempt.part, "bash", { command })
      expect(attempt.result.stderr).toContain("managed permission requires interactive approval; auto-rejecting")
      expect(yield* Effect.promise(() => Bun.file(path.join(fixture.home, "headless-denied.txt")).exists())).toBe(false)
      org.verify()
    }),
  timeout,
)

cliIt.live(
  "the real server exposes managed state, accepts only interactive once, and rechecks a pending operation after refresh",
  (fixture) =>
    Effect.gen(function* () {
      const org = yield* cloud([{ unrestricted_mode: "deny", shell: { bash: { fallback: "ask", rules: [] } } }], 1)
      const server = yield* fixture.opencode.serve({ env: environment(fixture, org.url, bash), readyTimeoutMs: 30_000 })
      const request = api(server.url, fixture.home)
      const state = request("/permission/policy")
      const active = { status: "active", organization, revision, unrestricted: false }
      expect(yield* state).toEqual(active)

      const file = path.join(fixture.home, "interactive.txt")
      const command = "touch interactive.txt"
      const pending = (id: string) =>
        request("/permission").pipe(
          Effect.map((data) =>
            z
              .array(z.looseObject({ id: z.string(), sessionID: z.string() }))
              .parse(data)
              .find((item) => item.sessionID === id),
          ),
        )
      const first = yield* prompt(fixture, request, "bash", shell(command))
      const send = yield* first.send.pipe(Effect.forkScoped)
      const ask = yield* pollWithTimeout(pending(first.id), "managed approval did not become pending", "15 seconds")
      expect(ask).toMatchObject({ permission: "bash", managed: { revision } })
      const reply = `/permission/${ask.id}/reply`
      expect(yield* request(reply, { reply: "once" })).toBe(true)
      expect(yield* request(reply, { reply: "always", interactive: true })).toBe(true)
      expect(yield* pending(first.id)).toMatchObject({ id: ask.id, managed: { revision } })
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)

      expect(yield* request(reply, { reply: "once", interactive: true })).toBe(true)
      yield* Fiber.join(send)
      expect((yield* first.parts).at(-1)).toMatchObject({ tool: "bash", state: { status: "completed" } })
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(true)
      yield* Effect.promise(() => rm(file))

      const second = yield* prompt(fixture, request, "bash", shell(command), first.id)
      const again = yield* second.send.pipe(Effect.forkScoped)
      const stale = yield* pollWithTimeout(
        pending(first.id),
        "once unexpectedly authorized a second call",
        "15 seconds",
      )
      expect(stale.id).not.toBe(ask.id)
      expect(stale.managed).toEqual({ revision })
      const prior = org.hits.length
      org.refresh([{ unrestricted_mode: "deny", shell: { bash: { fallback: "deny", rules: [] } } }])
      expect(
        yield* pollWithTimeout(
          state.pipe(
            Effect.map((current) => {
              const parsed = z.object({ revision: z.number() }).safeParse(current)
              return parsed.success && parsed.data.revision === revision + 1 ? current : undefined
            }),
          ),
          "the new managed revision did not become active",
          "10 seconds",
        ),
      ).toEqual({ ...active, revision: revision + 1 })
      expect(yield* request(`/permission/${stale.id}/reply`, { reply: "once", interactive: true })).toBe(true)
      yield* Fiber.join(again)
      denied((yield* second.parts).at(-1), "bash", { command })
      expect(yield* Effect.promise(() => Bun.file(file).exists())).toBe(false)
      org.verify()
      expect(org.hits.slice(prior)).toContainEqual({ pathname: route, authorization: bear, conditional: etag })
    }),
  timeout,
)
