// Loopback pairing: the shared 32-byte key, the HMAC challenge exchange that proves
// both ends hold it, and the URL that hands it to the extension through the browser.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Log } from "./log"
import { Paths } from "./paths"

const log = Log.create({ service: "browser.pair" })

export const PairingPath = "/__kilo_browser_pair"
// The extension redeems the fragment's token here, once, for the durable key.
export const PairingKeyPath = "/__kilo_browser_pair/key"
export const SocketPath = "/__kilo_browser"
export const KeyBytes = 32
export const NonceBytes = 16
// Pairing tokens are single use and short lived: they ride the opener's argv, which
// every local process can read, so one is worth nothing once redeemed or expired.
export const TokenBytes = 16
export const PairingTtl = 60_000

const File = z.object({ v: z.literal(1), key: z.string() })

export type Opener = (url: string) => Promise<void>

export function encode(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url")
}

export function decode(text: string, bytes: number) {
  const value = Buffer.from(text, "base64url")
  return value.length === bytes && value.toString("base64url") === text ? value : undefined
}

export function nonce(bytes = NonceBytes) {
  return encode(randomBytes(bytes))
}

export async function load(file = Paths.pairing()) {
  const text = await fs.readFile(file, "utf8").catch((error) => {
    // ENOENT is the normal first run; anything else is worth a line in the log.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    log.warn("cannot read the pairing file", { file, error })
    return undefined
  })
  // Two hubs starting at once both see ENOENT, so the first run uses an exclusive
  // create and whoever loses re-reads the winner's key instead of overwriting it.
  if (text === undefined) return create(file)
  const parsed = File.safeParse(parse(text))
  if (parsed.success && decode(parsed.data.key, KeyBytes)) return parsed.data.key
  log.warn("replacing an unusable pairing file", { file })
  return save(file)
}

// Writes a fresh key only when the file does not exist yet. Returns the key that is
// on disk afterwards, which may be another process's.
async function create(file: string) {
  const key = encode(randomBytes(KeyBytes))
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  try {
    await fs.writeFile(file, JSON.stringify({ v: 1, key }), { mode: 0o600, flag: "wx" })
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST")) throw error
    const existing = await fs.readFile(file, "utf8").catch(() => undefined)
    const parsed = existing === undefined ? undefined : File.safeParse(parse(existing))
    if (parsed?.success && decode(parsed.data.key, KeyBytes)) return parsed.data.key
    // The winner left an unusable file; replacing it is the only way forward.
    log.warn("replacing a pairing file that another process left unusable", { file })
    return save(file)
  }
  return key
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    log.warn("the pairing file is not valid JSON", { error })
    return undefined
  }
}

export async function save(file = Paths.pairing()) {
  const key = encode(randomBytes(KeyBytes))
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.tmp`
  await fs.writeFile(temp, JSON.stringify({ v: 1, key }), { mode: 0o600 })
  await fs.rename(temp, file)
  await fs.chmod(file, 0o600)
  return key
}

export function mac(key: string, payload: string) {
  const secret = decode(key, KeyBytes)
  if (!secret) throw new Error("the pairing key is not 32 bytes")
  return createHmac("sha256", secret).update(payload, "utf8").digest("base64url")
}

export function extensionMac(key: string, nonceH: string, nonceE: string) {
  return mac(key, `ext|${nonceH}|${nonceE}`)
}

export function hubMac(key: string, nonceH: string, nonceE: string) {
  return mac(key, `hub|${nonceE}|${nonceH}`)
}

// Constant-time comparison of two base64url MACs.
export function equal(left: string, right: string) {
  const a = Buffer.from(left, "base64url")
  const b = Buffer.from(right, "base64url")
  if (a.length === 0 || a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export function ws(port: number) {
  return `ws://127.0.0.1:${port}${SocketPath}`
}

// The pairing page URL the CLI hands to the system opener. It carries a single-use
// token, never the durable key: argv is world-readable on Linux, and a leaked key
// would let another local user forge the extension handshake for good.
export function url(input: { port: number; hubId: string; token: string }) {
  const params = new URLSearchParams({ v: "1", hub: input.hubId, t: input.token, ws: ws(input.port) })
  return `http://127.0.0.1:${input.port}${PairingPath}#${params.toString()}`
}

// What the extension receives in exchange for the token. `ws` saves it from guessing
// the port again, and the key is the durable secret it will HMAC with.
export const KeyExchange = z.object({ v: z.literal(1), key: z.string(), ws: z.string() })
export type KeyExchange = z.infer<typeof KeyExchange>

export type Exec = (cmd: string[]) => Promise<number>

export function opener(input: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; exec?: Exec } = {}): Opener {
  const platform = input.platform ?? process.platform
  const env = input.env ?? process.env
  // A missing opener binary must read as "this command failed", not as a crash: the
  // caller falls through to the next platform command.
  const exec =
    input.exec ??
    (async (cmd: string[]) => {
      try {
        return await Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).exited
      } catch {
        return 1
      }
    })
  const wsl = platform === "linux" && Boolean(env.WSL_DISTRO_NAME ?? env.WSL_INTEROP)
  return async (target) => {
    const cmd =
      platform === "darwin"
        ? ["open", target]
        : platform === "win32"
          ? ["cmd.exe", "/c", "start", "", target]
          : wsl
            ? ["wslview", target]
            : ["xdg-open", target]
    if ((await exec(cmd)) === 0) return
    // wslview comes from wslu, which is not installed everywhere.
    if (wsl && (await exec(["cmd.exe", "/c", "start", "", target])) === 0) return
    throw new Error(`cannot open ${target}`)
  }
}

export async function open(target: string, input: { opener?: Opener } = {}) {
  await (input.opener ?? opener())(target)
}
