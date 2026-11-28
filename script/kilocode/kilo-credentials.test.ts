// kilocode_change - new file
// Runs .github/actions/kilo-credentials/kilo-credentials.sh against a stand-in GitHub OIDC endpoint
// and a stand-in STS. Both answer on one local HTTPS server with a throwaway certificate for the
// real host names, reached through a local CONNECT proxy (HTTPS_PROXY), so the script keeps its
// fixed STS origins. curl and jq run through wrappers that log their command lines, and a stand-in
// `sleep` logs each wait and returns at once. Every token and value is synthetic. Needs bash, curl,
// jq and openssl.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https"
import { connect, createServer as createNetServer, type Server as NetServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"

const SCRIPT =
  process.env.KILO_CREDENTIALS_SCRIPT ??
  path.resolve(import.meta.dir, "../../.github/actions/kilo-credentials/kilo-credentials.sh")
const ACTION_DIR = path.dirname(SCRIPT)
const STS = "https://sts.kiloapps.io"
const STS_STAGING = "https://sts-staging.kiloapps.io"
const OIDC_HOST = "token.actions.test"
const HOSTS = ["sts.kiloapps.io", "sts-staging.kiloapps.io", OIDC_HOST]
const REQUEST_TOKEN = "req-token.synthetic_ABC123"
const WORKLOAD = "ci-test-release"
const FETCHED_AT = "2026-11-27T10:00:00.123Z"

const A = "KILOCODE_JETBRAINS_MARKETPLACE_TOKEN"
const J = "KILOCODE_JETBRAINS_PRIVATE_KEY"
const M = "KILOCODE_MAINTAINER_APP_KEY"
const U = "KILOCODE_AUR_KEY"
const SECRETS: Record<string, string> = {
  [A]: "rk-synthetic-7f3a",
  [J]: "-----BEGIN KEY-----\r\nline-one-synthetic\nline%0Atwo-synthetic\n-----END KEY-----\n",
  [M]: "appkey-first-synthetic\nappkey-second-synthetic\n",
  [U]: "unrequested-synthetic-99",
}
const REQUESTED = `${A}\n  ${J}  \n${M}\n\n`
const VALUE_MASKS = [
  "rk-synthetic-7f3a",
  "-----BEGIN KEY-----",
  "line-one-synthetic",
  "line%250Atwo-synthetic",
  "-----END KEY-----",
  "-----BEGIN KEY-----%0D%0Aline-one-synthetic%0Aline%250Atwo-synthetic%0A-----END KEY-----%0A",
  "appkey-first-synthetic",
  "appkey-second-synthetic",
  "appkey-first-synthetic%0Aappkey-second-synthetic%0A",
  "unrequested-synthetic-99",
]
const VALUE_PIECES = Object.values(SECRETS).flatMap((value) => value.split(/[\r\n]+/).filter((piece) => piece.trim()))
const COLLISION_DELIMITER = "ghadelimiter_" + "00".repeat(16)
const ERROR_LINE = /^::error title=kilo-credentials::[A-Za-z0-9 ._:;/()=,?-]{1,300}$/
const NOTICE_LINE = /^kilo-credentials: .*; retrying in \d+ s \(attempt [23] of 3\)$/

// The union of the secrets of services/sts/policy/ci-kilocode-*.yaml on Kilo-Org/cloud main.
const LIVE_KEYS = [
  "KILOCODE_AUR_KEY",
  "KILOCODE_MAINTAINER_APP_KEY",
  "KILOCODE_JETBRAINS_MARKETPLACE_TOKEN",
  "KILOCODE_JETBRAINS_PRIVATE_KEY",
  "KILOCODE_JETBRAINS_PRIVATE_KEY_PASSWORD",
  "KILOCODE_JETBRAINS_CERTIFICATE_CHAIN",
  "KILOCODE_SECURITY_ALERTS_SLACK_WEBHOOK",
  "KILOCODE_COMMUNITY_TRIAGE_SLACK_TOKEN",
  "KILOCODE_COMMUNITY_TRIAGE_SLACK_WEBHOOK",
  "KILOCODE_V2_SYNC_SLACK_WEBHOOK",
  "KILOCODE_OPENCODE_WATCH_SLACK_WEBHOOK",
]
// Keys whose consumers read a file.
const FILE_KEYS = [U, J, "KILOCODE_JETBRAINS_CERTIFICATE_CHAIN"]
const EXPECTED_OUTPUTS = [
  ...LIVE_KEYS.filter((key) => !FILE_KEYS.includes(key)),
  ...FILE_KEYS.map((key) => `${key}_FILE`),
].sort()

type Reply = { status: number; headers?: Record<string, string>; body?: string; drop?: boolean; unsized?: boolean }
type OidcMode = "ok" | "error" | "unauthorized" | "bad" | "concatenated"

function bundle(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    workload: WORKLOAD,
    environment: "production",
    etag: '"etag_synthetic_0123456789"',
    stale: false,
    fetchedAt: FETCHED_AT,
    secrets: Object.fromEntries(Object.entries(SECRETS).map(([name, value]) => [name, { value, version: 3 }])),
    missing: [],
    ...overrides,
  }
}
const json = (status: number, document: unknown, headers: Record<string, string> = {}): Reply => ({
  status,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(document),
})
const ok = () => json(200, bundle())
const unavailable = (retryAfterSeconds: number) => () =>
  json(503, { status: "unavailable", reason: "internal", retryAfterSeconds })
const HOSTILE = "boom\n::set-env name=PWNED::1\n\x1b[31m::add-mask::x %0A::error::injected\r\n" + "A".repeat(5000)

const state = {
  sts: [ok] as Array<() => Reply>,
  oidc: ["ok"] as OidcMode[],
  audience: STS,
  stdoutPath: "",
  oidcRequests: 0,
  /** OIDC tokens issued in this run, oldest first; every token issued in any run is in `everIssued`. */
  issued: [] as string[],
  everIssued: [] as string[],
  stsRequests: [] as boolean[],
  /** Per STS request: the bearer, whether it was the newest token, and whether it was masked already. */
  stsBearers: [] as Array<{ bearer: string; newest: boolean; masked: boolean }>,
  proxied: [] as string[],
}
function reset(sts: Array<() => Reply> = [ok], oidc: OidcMode[] = ["ok"], audience = STS) {
  state.sts = sts
  state.oidc = oidc
  state.audience = audience
  state.oidcRequests = 0
  state.issued = []
  state.stsRequests = []
  state.stsBearers = []
  state.proxied = []
}

function send(response: ServerResponse, reply: Reply) {
  response.on("error", () => {})
  if (reply.drop) {
    response.socket?.destroy()
    return
  }
  const body = Buffer.from(reply.body ?? "")
  if (reply.unsized) {
    response.writeHead(reply.status, reply.headers ?? {})
    response.write(body)
    response.end()
    return
  }
  response.writeHead(reply.status, { ...reply.headers, "content-length": String(body.length) })
  response.end(body)
}

function handle(request: IncomingMessage, response: ServerResponse) {
  request.socket.on("error", () => {})
  const chunks: Buffer[] = []
  request.on("data", (chunk: Buffer) => chunks.push(chunk))
  request.on("end", () => {
    const host = (request.headers.host ?? "").split(":")[0] ?? ""
    const url = new URL(request.url ?? "/", `https://${host}`)
    const body = Buffer.concat(chunks).toString()
    if (host === OIDC_HOST && request.method === "GET") {
      state.oidcRequests += 1
      const valid =
        url.pathname === "/oidc" &&
        url.searchParams.get("api-version") === "2.0" &&
        url.searchParams.get("audience") === state.audience &&
        request.headers.authorization === `Bearer ${REQUEST_TOKEN}`
      if (!valid) return send(response, json(400, { error: "oidc_mismatch" }))
      const mode = state.oidc[Math.min(state.oidcRequests - 1, state.oidc.length - 1)] ?? "ok"
      if (mode === "error") return send(response, { status: 500, body: HOSTILE })
      if (mode === "unauthorized") return send(response, json(401, { message: "Unauthorized" }))
      if (mode === "bad") return send(response, json(200, { value: "not a jwt\n::error::x" }))
      // A distinct token per request, so the STS side can tell which one it received.
      const token = [
        "hdrSynthetic",
        `payload${state.everIssued.length}Synthetic`,
        `sig-synthetic_${state.everIssued.length}`,
      ].join(".")
      state.issued.push(token)
      state.everIssued.push(token)
      if (mode === "concatenated")
        return send(response, { status: 200, body: JSON.stringify({ value: token }).repeat(2) })
      return send(response, json(200, { count: 1, value: token }))
    }
    if (`https://${host}` === state.audience && request.method === "POST") {
      const bearer = (request.headers.authorization ?? "").replace(/^Bearer /, "")
      // The script's stdout goes to a file, and jq printed the mask before curl started, so the
      // file shows whether this token was masked before it was used.
      const stdout = readFileSync(state.stdoutPath, "utf8").split("\n")
      state.stsBearers.push({
        bearer,
        newest: bearer !== "" && bearer === state.issued.at(-1),
        masked: stdout.includes(`::add-mask::${bearer}`),
      })
      const valid =
        url.pathname === "/v1/bundle" &&
        bearer === state.issued.at(-1) &&
        request.headers["content-type"] === "application/json" &&
        body === "{}"
      state.stsRequests.push(valid)
      if (!valid) return send(response, json(400, { error: "request_mismatch" }))
      const reply = state.sts[Math.min(state.stsRequests.length - 1, state.sts.length - 1)]
      return send(response, reply ? reply() : ok())
    }
    send(response, { status: 404, body: "no route" })
  })
}

let root = ""
let cert = ""
let wrap = ""
let fixedOd = ""
let argvLog = ""
let httpsServer: HttpsServer
let proxy: NetServer
let proxyPort = 0
const bashPath = Bun.which("bash") ?? "bash"
// The action is for the Ubuntu runners its workflows use; the test relies on POSIX file modes and
// bash wrappers on PATH, so it skips on Windows.
const supported = process.platform !== "win32"

beforeAll(async () => {
  if (!supported) return
  root = mkdtempSync(path.join(tmpdir(), "kilo-credentials-test-"))
  cert = path.join(root, "cert.pem")
  const key = path.join(root, "key.pem")
  const openssl = Bun.spawnSync([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=sts.kiloapps.io",
    "-addext",
    `subjectAltName=${HOSTS.map((host) => `DNS:${host}`).join(",")}`,
    "-keyout",
    key,
    "-out",
    cert,
  ])
  if (openssl.exitCode !== 0) throw new Error(`openssl failed: ${openssl.stderr.toString()}`)

  wrap = path.join(root, "wrap")
  mkdirSync(wrap)
  argvLog = path.join(root, "argv.log")
  const realCurl = Bun.which("curl")
  const realJq = Bun.which("jq")
  if (!realCurl || !realJq) throw new Error("curl and jq must be installed")
  // CURL_FAIL_ONCE=sts:<exit> or oidc:<exit> makes the first matching call exit with that code
  // without a request; the STS call is the one with --dump-header.
  writeFileSync(
    path.join(wrap, "curl"),
    [
      "#!/bin/bash",
      `printf '%s\\0' curl "$@" >> "$ARGV_LOG"`,
      `printf '\\n' >> "$ARGV_LOG"`,
      `if [[ -n \${CURL_FAIL_ONCE-} && ! -e $CURL_FAIL_ONCE_MARKER ]]; then`,
      "  target=no-match",
      `  for argument in "$@"; do [[ $argument == --dump-header ]] && target=sts; done`,
      "  [[ $target == sts ]] || target=oidc",
      `  if [[ \${CURL_FAIL_ONCE%%:*} == "$target" ]]; then`,
      `    : > "$CURL_FAIL_ONCE_MARKER"`,
      "    cat > /dev/null",
      `    exit "\${CURL_FAIL_ONCE#*:}"`,
      "  fi",
      "fi",
      `exec "${realCurl}" "$@"`,
      "",
    ].join("\n"),
  )
  writeFileSync(
    path.join(wrap, "jq"),
    `#!/bin/bash\nprintf '%s\\0' jq "$@" >> "$ARGV_LOG"\nprintf '\\n' >> "$ARGV_LOG"\nexec "${realJq}" "$@"\n`,
  )
  writeFileSync(path.join(wrap, "sleep"), `#!/bin/sh\nprintf '%s\\n' "$1" >> "$SLEEP_LOG"\n`)
  for (const tool of ["curl", "jq", "sleep"]) chmodSync(path.join(wrap, tool), 0o755)
  fixedOd = path.join(root, "fixed-od")
  mkdirSync(fixedOd)
  writeFileSync(path.join(fixedOd, "od"), "#!/bin/sh\necho ' 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'\n")
  chmodSync(path.join(fixedOd, "od"), 0o755)

  httpsServer = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, handle)
  const httpsListening = Promise.withResolvers<void>()
  httpsServer.listen(0, "127.0.0.1", httpsListening.resolve)
  await httpsListening.promise
  const httpsAddress = httpsServer.address()
  if (httpsAddress === null || typeof httpsAddress === "string") throw new Error("the stand-in server has no port")
  const httpsPort = httpsAddress.port

  proxy = createNetServer((client) => {
    client.on("error", () => {})
    let buffered = Buffer.alloc(0)
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf("\r\n\r\n")
      if (end < 0) return
      client.off("data", onData)
      const match = /^CONNECT ([^ :]+):443 HTTP\/1\.[01]\r\n/.exec(buffered.subarray(0, end).toString())
      const host = match?.[1]
      if (!host || !HOSTS.includes(host)) {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
        return
      }
      state.proxied.push(host)
      const upstream = connect(httpsPort, "127.0.0.1", () => {
        client.write("HTTP/1.1 200 Connection established\r\n\r\n")
        const rest = buffered.subarray(end + 4)
        if (rest.length > 0) upstream.write(rest)
        client.pipe(upstream)
        upstream.pipe(client)
      })
      upstream.on("error", () => client.destroy())
      client.on("close", () => upstream.destroy())
    }
    client.on("data", onData)
  })
  const proxyListening = Promise.withResolvers<void>()
  proxy.listen(0, "127.0.0.1", proxyListening.resolve)
  await proxyListening.promise
  const proxyAddress = proxy.address()
  if (proxyAddress === null || typeof proxyAddress === "string") throw new Error("the proxy has no port")
  proxyPort = proxyAddress.port
})

afterAll(() => {
  httpsServer?.close()
  proxy?.close()
  if (root) rmSync(root, { recursive: true, force: true })
})

type Run = {
  code: number
  output: string
  outputs: string
  envWrites: string
  leftovers: string[]
  tree: Map<string, { mode: number; data: Buffer | null }>
  runnerTemp: string
  waits: number[]
}

async function run(options: { env?: Record<string, string | undefined>; readonlyOutput?: boolean } = {}): Promise<Run> {
  const work = mkdtempSync(path.join(root, "run-"))
  const runnerTemp = path.join(work, "runner-temp")
  mkdirSync(runnerTemp)
  const githubEnv = path.join(work, "github_env")
  const githubOutput = path.join(work, "github_output")
  const sleepLog = path.join(work, "sleep.log")
  writeFileSync(githubEnv, "")
  writeFileSync(githubOutput, "")
  if (options.readonlyOutput) chmodSync(githubOutput, 0o444)
  state.stdoutPath = path.join(work, "stdout.log")
  const stdoutFile = openSync(state.stdoutPath, "w")
  const stderrFile = openSync(path.join(work, "stderr.log"), "w")
  const env: Record<string, string> = {
    PATH: `${wrap}:${process.env.PATH ?? ""}`,
    HOME: work,
    RUNNER_TEMP: runnerTemp,
    GITHUB_ENV: githubEnv,
    GITHUB_OUTPUT: githubOutput,
    GITHUB_ACTION_PATH: ACTION_DIR,
    CURL_CA_BUNDLE: cert,
    HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
    ARGV_LOG: argvLog,
    SLEEP_LOG: sleepLog,
    CURL_FAIL_ONCE_MARKER: path.join(work, "curl-failed-once"),
    ACTIONS_ID_TOKEN_REQUEST_URL: `https://${OIDC_HOST}/oidc?api-version=2.0`,
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQUEST_TOKEN,
    INPUT_WORKLOAD: WORKLOAD,
    INPUT_SECRETS: REQUESTED,
    INPUT_STS_URL: STS,
  }
  for (const [name, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[name]
    else env[name] = value
  }
  const proc = Bun.spawn([bashPath, SCRIPT], { env, stdout: stdoutFile, stderr: stderrFile })
  const code = await proc.exited
  closeSync(stdoutFile)
  closeSync(stderrFile)
  const tree = new Map<string, { mode: number; data: Buffer | null }>()
  const walk = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const full = path.join(directory, name)
      const stats = statSync(full)
      tree.set(path.relative(runnerTemp, full), {
        mode: stats.mode & 0o777,
        data: stats.isDirectory() ? null : readFileSync(full),
      })
      if (stats.isDirectory()) walk(full)
    }
  }
  walk(runnerTemp)
  const result: Run = {
    code,
    output: readFileSync(state.stdoutPath, "utf8") + readFileSync(path.join(work, "stderr.log"), "utf8"),
    outputs: readFileSync(githubOutput, "utf8"),
    envWrites: readFileSync(githubEnv, "utf8"),
    leftovers: readdirSync(runnerTemp),
    tree,
    runnerTemp,
    waits: existsSync(sleepLog) ? readFileSync(sleepLog, "utf8").split("\n").filter(Boolean).map(Number) : [],
  }
  rmSync(work, { recursive: true, force: true })
  return result
}

/** GITHUB_OUTPUT: heredoc outputs with their delimiters, and single-line NAME=value outputs. */
function parseOutputs(text: string) {
  const values: Record<string, string> = {}
  const delimiters: string[] = []
  const plain: Record<string, string> = {}
  const lines = text.split("\n")
  for (let i = 0; i < lines.length; ) {
    const line = lines[i] ?? ""
    if (line === "") {
      i += 1
      continue
    }
    const heredoc = /^([A-Za-z_][A-Za-z0-9_]*)<<(ghadelimiter_[0-9a-f]{32})$/.exec(line)
    if (!heredoc) {
      const single = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (!single)
        throw new Error(`GITHUB_OUTPUT line is neither a heredoc header nor NAME=value: ${line.slice(0, 40)}`)
      plain[single[1]!] = single[2]!
      i += 1
      continue
    }
    const end = lines.indexOf(heredoc[2]!, i + 1)
    if (end < 0) throw new Error(`no closing delimiter for ${heredoc[1]}`)
    values[heredoc[1]!] = lines.slice(i + 1, end).join("\n")
    delimiters.push(heredoc[2]!)
    i = end + 1
  }
  return { values, delimiters, plain }
}

/** The log as the runner shows it: add-mask commands are consumed, not shown. */
const visible = (output: string) => output.split("\n").filter((line) => line && !line.startsWith("::add-mask::"))

function expectNoSecrets(text: string) {
  for (const piece of [REQUEST_TOKEN, ...state.everIssued, ...VALUE_PIECES]) expect(text).not.toContain(piece)
}

/** Every STS request carried the newest OIDC token, already masked, and each token was used once. */
function expectTokenDiscipline() {
  for (const request of state.stsBearers) {
    expect(request.newest).toBe(true)
    expect(request.masked).toBe(true)
  }
  expect(new Set(state.stsBearers.map((request) => request.bearer)).size).toBe(state.stsBearers.length)
}

function expectFailure(r: Run, contains: string | undefined, { stsCalled = true, waits = [] as number[] } = {}) {
  const shown = visible(r.output)
  expect(r.code).not.toBe(0)
  expect(shown).toHaveLength(waits.length + 1)
  for (const line of shown.slice(0, waits.length)) expect(line).toMatch(NOTICE_LINE)
  const line = shown.at(-1) ?? ""
  expect(line).toMatch(ERROR_LINE)
  if (contains) expect(line).toContain(contains)
  expect(r.waits).toEqual(waits)
  expect(r.outputs).toBe("")
  expect(r.envWrites).toBe("")
  expect(r.leftovers).toEqual([])
  expectNoSecrets(shown.join("\n"))
  expect(state.stsRequests.length > 0).toBe(stsCalled)
  expect(state.stsRequests.every(Boolean)).toBe(true)
  expectTokenDiscipline()
}

function expectRetriedSuccess(r: Run, waits: number[], firstNotice: string | RegExp) {
  expect(r.code).toBe(0)
  expect(r.waits).toEqual(waits)
  const notice = visible(r.output)[0] ?? ""
  if (typeof firstNotice === "string") expect(notice).toBe(firstNotice)
  else expect(notice).toMatch(firstNotice)
  expect(Object.keys(parseOutputs(r.outputs).values).sort()).toEqual([A, M])
  expect(state.stsRequests.every(Boolean)).toBe(true)
  expectTokenDiscipline()
}

describe.skipIf(!supported)("kilo-credentials action", () => {
  test("action.yml declares the live kilocode policy keys, file-read keys as <KEY>_FILE", () => {
    const action = readFileSync(path.join(ACTION_DIR, "action.yml"), "utf8")
    const declared = [
      ...action.matchAll(
        /^ {2}([A-Z][A-Z0-9_]*):\n {4}description: .*\n {4}value: \$\{\{ steps\.bundle\.outputs\.([A-Z0-9_]+) \}\}$/gm,
      ),
    ]
    for (const match of declared) expect(match[2]).toBe(match[1])
    expect(declared.map((match) => match[1]).sort()).toEqual(EXPECTED_OUTPUTS)
  })

  test("sets only the requested outputs, writes the key file, masks everything first", async () => {
    reset()
    const r = await run()
    expect(r.code).toBe(0)
    const { values, delimiters, plain } = parseOutputs(r.outputs)
    expect(Object.keys(values).sort()).toEqual([A, M])
    expect(values[A]).toBe(SECRETS[A])
    expect(values[M]).toBe(SECRETS[M])
    expect(new Set(delimiters).size).toBe(2)
    expect(Object.keys(plain)).toEqual([`${J}_FILE`])
    const relative = path.relative(r.runnerTemp, plain[`${J}_FILE`] ?? "")
    const directory = path.dirname(relative)
    expect(directory).toMatch(/^kilo-credentials-files\.[A-Za-z0-9]{6}$/)
    expect(r.tree.get(directory)?.mode).toBe(0o700)
    expect(r.tree.get(relative)?.mode).toBe(0o600)
    expect(r.tree.get(relative)?.data?.equals(Buffer.from(SECRETS[J]!))).toBe(true)
    expect([...r.tree.keys()].sort()).toEqual([directory, relative].sort())
    for (const piece of SECRETS[J]!.split(/[\r\n]+/).filter(Boolean)) expect(r.outputs).not.toContain(piece)
    expect(r.outputs).not.toContain(SECRETS[U])
    expect(r.outputs).not.toContain(U)
    expect(r.envWrites).toBe("")
    const masked = r.output
      .split("\n")
      .filter((line) => line.startsWith("::add-mask::"))
      .map((line) => line.slice("::add-mask::".length))
    expect(masked.sort()).toEqual([...state.issued, ...VALUE_MASKS].sort())
    const lines = r.output.split("\n").filter(Boolean)
    const firstOther = lines.findIndex((line) => !line.startsWith("::add-mask::"))
    expect(lines.slice(firstOther).some((line) => line.startsWith("::add-mask::"))).toBe(false)
    expect(visible(r.output)).toEqual([`kilo-credentials: set outputs for ${A} ${J} ${M} from the ${WORKLOAD} bundle`])
    expect(r.waits).toEqual([])
    expect(state.stsRequests).toEqual([true])
    expect(state.oidcRequests).toBe(1)
    expectTokenDiscipline()
    expect([...new Set(state.proxied)].sort()).toEqual([OIDC_HOST, "sts.kiloapps.io"].sort())
  })

  test("value keys only create no key file", async () => {
    reset()
    const r = await run({ env: { INPUT_SECRETS: A } })
    const { values, plain } = parseOutputs(r.outputs)
    expect(r.code).toBe(0)
    expect(values).toEqual({ [A]: SECRETS[A]! })
    expect(plain).toEqual({})
    expect(r.tree.size).toBe(0)
  })

  test("file keys only set no value output", async () => {
    reset()
    const r = await run({ env: { INPUT_SECRETS: J } })
    const { values, plain } = parseOutputs(r.outputs)
    expect(r.code).toBe(0)
    expect(values).toEqual({})
    expect(Object.keys(plain)).toEqual([`${J}_FILE`])
    const entry = r.tree.get(path.relative(r.runnerTemp, plain[`${J}_FILE`]!))
    expect(entry?.mode).toBe(0o600)
    expect(entry?.data?.equals(Buffer.from(SECRETS[J]!))).toBe(true)
  })

  test("the staging STS gets a token for its own audience", async () => {
    reset([ok], ["ok"], STS_STAGING)
    const r = await run({ env: { INPUT_STS_URL: STS_STAGING } })
    expect(r.code).toBe(0)
    expect(state.stsRequests).toEqual([true])
    expect([...new Set(state.proxied)].sort()).toEqual([OIDC_HOST, "sts-staging.kiloapps.io"].sort())
  })

  test("retries a 503 after its retryAfterSeconds with a new OIDC token", async () => {
    reset([unavailable(1), ok])
    expectRetriedSuccess(
      await run(),
      [1],
      "kilo-credentials: STS bundle request returned HTTP 503 (unavailable internal); retryAfterSeconds=1; retrying in 1 s (attempt 2 of 3)",
    )
    expect(state.oidcRequests).toBe(2)
    expect(state.stsBearers.map((request) => request.bearer)).toEqual(state.issued)
  })

  test("retries a 503 after its Retry-After header", async () => {
    reset([() => ({ status: 503, headers: { "retry-after": "1" }, body: "busy" }), ok])
    expectRetriedSuccess(
      await run(),
      [1],
      "kilo-credentials: STS bundle request returned HTTP 503; Retry-After=1; retrying in 1 s (attempt 2 of 3)",
    )
  })

  test("waits 5 s after a 503 without a hint", async () => {
    reset([() => ({ status: 503, body: "busy" }), ok])
    expectRetriedSuccess(
      await run(),
      [5],
      "kilo-credentials: STS bundle request returned HTTP 503; retrying in 5 s (attempt 2 of 3)",
    )
  })

  test("caps the wait at 60 s", async () => {
    reset([unavailable(3600), ok])
    expectRetriedSuccess(
      await run(),
      [60],
      "kilo-credentials: STS bundle request returned HTTP 503 (unavailable internal); retryAfterSeconds=3600; retrying in 60 s (attempt 2 of 3)",
    )
  })

  test("retries an STS timeout (curl 28) after 5 s", async () => {
    reset()
    expectRetriedSuccess(
      await run({ env: { CURL_FAIL_ONCE: "sts:28" } }),
      [5],
      "kilo-credentials: STS bundle request failed (curl exit 28); retrying in 5 s (attempt 2 of 3)",
    )
    expect(state.stsRequests).toEqual([true])
    expect(state.oidcRequests).toBe(2)
  })

  test("retries a dropped STS connection", async () => {
    reset([() => ({ status: 0, drop: true }), ok])
    expectRetriedSuccess(
      await run(),
      [5],
      /^kilo-credentials: STS bundle request failed \(curl exit (52|56)\); retrying in 5 s/,
    )
    expect(state.stsRequests).toEqual([true, true])
  })

  test("retries an OIDC connection failure (curl 7)", async () => {
    reset()
    expectRetriedSuccess(
      await run({ env: { CURL_FAIL_ONCE: "oidc:7" } }),
      [5],
      "kilo-credentials: GitHub OIDC token request failed (curl exit 7); retrying in 5 s (attempt 2 of 3)",
    )
    expect(state.oidcRequests).toBe(1)
    expect(state.stsRequests).toEqual([true])
  })

  test("retries an OIDC 5xx on attempt 2 within the same budget", async () => {
    reset([unavailable(1), ok], ["ok", "error", "ok"])
    expectRetriedSuccess(
      await run(),
      [1, 5],
      "kilo-credentials: STS bundle request returned HTTP 503 (unavailable internal); retryAfterSeconds=1; retrying in 1 s (attempt 2 of 3)",
    )
    expect(state.oidcRequests).toBe(3)
    expect(state.stsRequests).toEqual([true, true])
    expect(state.stsBearers.map((request) => request.bearer)).toEqual(state.issued)
  })

  test("fails after three 503s, naming retryAfterSeconds", async () => {
    reset([unavailable(1)])
    expectFailure(
      await run(),
      "STS bundle request returned HTTP 503 (unavailable internal); retryAfterSeconds=1 after 3 attempts",
      {
        waits: [1, 1],
      },
    )
    expect(state.stsRequests).toHaveLength(3)
    expect(state.oidcRequests).toBe(3)
  })

  test("fails after three OIDC 5xx answers without calling STS", async () => {
    reset([ok], ["error"])
    expectFailure(await run(), "GitHub OIDC token request returned HTTP 500 after 3 attempts", {
      stsCalled: false,
      waits: [5, 5],
    })
    expect(state.oidcRequests).toBe(3)
  })

  test("does not retry an OIDC 401", async () => {
    reset([ok], ["unauthorized"])
    expectFailure(await run(), "GitHub OIDC token request returned HTTP 401", { stsCalled: false })
    expect(state.oidcRequests).toBe(1)
  })

  test("does not retry another curl error", async () => {
    reset()
    expectFailure(await run({ env: { CURL_FAIL_ONCE: "sts:6" } }), "STS bundle request failed (curl exit 6)", {
      stsCalled: false,
    })
  })

  test("does not retry a refusal", async () => {
    reset([() => json(403, { status: "denied", reason: "unknown_workload" })])
    expectFailure(await run(), "HTTP 403 (denied unknown_workload)")
    expect(state.stsRequests).toHaveLength(1)
  })

  test("fails on a stale bundle", async () => {
    reset([() => json(200, bundle({ stale: true }))])
    expectFailure(
      await run(),
      `STS served a stale copy of the ${WORKLOAD} bundle, fetched at ${FETCHED_AT}; run the job again later`,
    )
  })

  test("refuses a value that contains its delimiter", async () => {
    reset([
      () =>
        json(
          200,
          bundle({
            secrets: { ...bundle().secrets, [A]: { value: `x\n${COLLISION_DELIMITER}\ny-synthetic`, version: 1 } },
          }),
        ),
    ])
    expectFailure(
      await run({ env: { PATH: `${fixedOd}:${wrap}:${process.env.PATH ?? ""}` } }),
      "could not set the outputs",
    )
  })

  test("deletes the key file when GITHUB_OUTPUT cannot be written", async () => {
    reset()
    expectFailure(await run({ readonlyOutput: true }), "could not set the outputs")
  })

  test("names a missing tool", async () => {
    reset()
    const tools = path.join(root, "tools-without-jq")
    rmSync(tools, { recursive: true, force: true })
    mkdirSync(tools)
    for (const tool of ["awk", "cat", "curl", "mktemp", "od", "rm", "sleep", "tr", "wc"]) {
      symlinkSync(Bun.which(tool)!, path.join(tools, tool))
    }
    expectFailure(await run({ env: { PATH: tools } }), "jq is not installed on the runner", { stsCalled: false })
    expect(state.oidcRequests).toBe(0)
  })

  const failures: Array<[string, () => Reply, string | undefined]> = [
    [
      "a missing key",
      () => json(200, bundle({ secrets: { [A]: { value: SECRETS[A], version: 1 } }, missing: [J, M] })),
      `lacks requested keys: ${J}(not in the manager) ${M}(not in the manager)`,
    ],
    [
      "a key not granted",
      () => json(200, bundle({ secrets: { [A]: { value: SECRETS[A], version: 1 } } })),
      `lacks requested keys: ${J} ${M}`,
    ],
    ["401", () => json(401, { status: "denied", reason: "identity_rejected" }), "HTTP 401 (denied identity_rejected)"],
    ["a hostile 500 text", () => ({ status: 500, body: HOSTILE }), "STS bundle request returned HTTP 500"],
    [
      "a hostile 403 JSON",
      () =>
        json(403, {
          status: "denied",
          reason: "x\n::error::injected %0A",
          error: "a".repeat(10000),
          message: SECRETS[U],
        }),
      "HTTP 403 (denied)",
    ],
    ["an oversized 500", () => ({ status: 500, body: "E".repeat(3 * 1024 * 1024) }), "curl exit 63"],
    ["an oversized 200", () => ({ status: 200, body: " ".repeat(2 * 1024 * 1024) }), "curl exit 63"],
    [
      "an oversized 200 without a length",
      () => ({ status: 200, body: " ".repeat(2 * 1024 * 1024), unsized: true }),
      undefined,
    ],
    ["an empty 200", () => ({ status: 200 }), "STS bundle response"],
    ["malformed JSON", () => ({ status: 200, body: '{"status": "ok", "secrets": {' }), "not JSON"],
    [
      "concatenated JSON",
      () => ({ status: 200, body: JSON.stringify(bundle()) + JSON.stringify(bundle()) }),
      "expected shape",
    ],
    ["a JSON array", () => json(200, [SECRETS[A]]), "expected shape"],
    ["an extra key", () => json(200, bundle({ extra: 1 })), "expected shape"],
    ["another workload", () => json(200, bundle({ workload: "ci-other" })), `workload ci-other, not ${WORKLOAD}`],
    [
      "a negative version",
      () => json(200, bundle({ secrets: { [A]: { value: "v-synthetic", version: -1 } } })),
      "expected shape",
    ],
    [
      "a value that is not a string",
      () => json(200, bundle({ secrets: { [A]: { value: 12345, version: 1 } } })),
      "expected shape",
    ],
    [
      "a lower-case secret name",
      () => json(200, bundle({ secrets: { lower_key: { value: "v-synthetic", version: 1 } } })),
      "expected shape",
    ],
    ["304", () => ({ status: 304, headers: { etag: '"etag_synthetic_0123456789"' } }), "HTTP 304"],
    ["204", () => ({ status: 204 }), "HTTP 204"],
    ["404", () => ({ status: 404, body: "Not Found" }), "HTTP 404"],
    ["302", () => ({ status: 302, headers: { location: "https://example.com/" } }), "HTTP 302"],
  ]
  test.each(failures)("fails on %s with one capped line", async (_label, reply, contains) => {
    reset([reply])
    expectFailure(await run(), contains)
  })

  test.each([
    ["a malformed OIDC token", "bad", "GitHub OIDC response holds no token"],
    ["concatenated OIDC JSON", "concatenated", "GitHub OIDC response holds no token"],
  ] as const)("fails on %s before calling STS", async (_label, oidc, contains) => {
    reset([ok], [oidc])
    expectFailure(await run(), contains, { stsCalled: false })
  })

  test.each([
    ["no id-token permission", { ACTIONS_ID_TOKEN_REQUEST_TOKEN: undefined }, "id-token: write"],
    ["a bad workload", { INPUT_WORKLOAD: "CI Release" }, "input workload is not an STS workload name"],
    ["another sts-url", { INPUT_STS_URL: "https://evil.example" }, "input sts-url must be"],
    ["an sts-url with a path", { INPUT_STS_URL: `${STS}/` }, "input sts-url must be"],
    ["an http sts-url", { INPUT_STS_URL: "http://sts.kiloapps.io" }, "input sts-url must be"],
    ["an sts-url with a port", { INPUT_STS_URL: `${STS}:443` }, "input sts-url must be"],
    ["an undeclared key", { INPUT_SECRETS: `${A}\nOTHER_TOKEN` }, "OTHER_TOKEN is not an output of action.yml"],
    ["a duplicate key", { INPUT_SECRETS: `${A}\n${A}` }, "requested twice"],
    ["a pasted value", { INPUT_SECRETS: `${A}\nrk-synthetic-7f3a` }, "line 2 is not a bundle key"],
    ["the old mapping syntax", { INPUT_SECRETS: `MARKETPLACE_TOKEN=${A}` }, "line 1 is not a bundle key"],
    ["an empty input", { INPUT_SECRETS: "\n \n" }, "names no bundle key"],
    ["an output name", { INPUT_SECRETS: `${U}_FILE` }, `request the bundle key ${U}, not the output ${U}_FILE`],
  ] as const)("refuses %s before any request", async (_label, env, contains) => {
    reset()
    expectFailure(await run({ env }), contains, { stsCalled: false })
    expect(state.oidcRequests).toBe(0)
  })

  test("no token or value reached a curl or jq command line", () => {
    const argv = readFileSync(argvLog, "utf8")
    expect(argv.split("\n").filter((line) => line.startsWith("curl\0")).length).toBeGreaterThan(20)
    expect(state.everIssued.length).toBeGreaterThan(20)
    expectNoSecrets(argv)
    for (const line of argv.split("\n").filter((entry) => entry.startsWith("curl\0"))) {
      expect(line).toContain("--config\0-")
    }
  })
})
