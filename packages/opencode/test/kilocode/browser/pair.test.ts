import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as pair from "../../../src/kilocode/browser/pair"

// Known-answer vectors: 32 x 0x01 key, 16 x 0x02 host nonce, 16 x 0x03 extension nonce.
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE"
const nonceH = "AgICAgICAgICAgICAgICAg"
const nonceE = "AwMDAwMDAwMDAwMDAwMDAw"

async function dir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-pair-"))
  return { root, file: path.join(root, "browser", "pairing.json") }
}

describe("pairing", () => {
  test("computes the extension MAC over the base64url nonces", () => {
    expect(pair.extensionMac(key, nonceH, nonceE)).toBe("QQ6dypvAuWdSlR5v19EnRZw2Al9rbol9SSlwLdq-j1U")
  })

  test("computes the hub MAC over the reversed nonces", () => {
    expect(pair.hubMac(key, nonceH, nonceE)).toBe("ykYc4ee2I3hJPbMK23qKFJIcNqp-ChDsiyob8KnobQc")
  })

  test("compares MACs in constant time and rejects mismatches", () => {
    const expected = pair.hubMac(key, nonceH, nonceE)
    expect(pair.equal(expected, expected)).toBe(true)
    expect(pair.equal(expected, pair.hubMac(key, nonceE, nonceH))).toBe(false)
    expect(pair.equal(expected, "short")).toBe(false)
    expect(pair.equal("", "")).toBe(false)
  })

  test("creates one private key file and reuses it", async () => {
    const at = await dir()
    const first = await pair.load(at.file)
    expect(pair.decode(first, pair.KeyBytes)).toBeDefined()
    const stat = await fs.stat(at.file)
    expect(stat.isFile()).toBe(true)
    // Windows reports 0666 for every file; 0600 is a POSIX guarantee.
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600)
    expect(await pair.load(at.file)).toBe(first)
    await fs.rm(at.root, { recursive: true, force: true })
  })

  test("gives two racing first runs the same key instead of overwriting it", async () => {
    const at = await dir()
    const [first, second] = await Promise.all([pair.load(at.file), pair.load(at.file)])
    expect(first).toBe(second)
    expect(JSON.parse(await fs.readFile(at.file, "utf8"))).toStrictEqual({ v: 1, key: first })
    await fs.rm(at.root, { recursive: true, force: true })
  })

  test("replaces a corrupt key file", async () => {
    const at = await dir()
    await fs.mkdir(path.dirname(at.file), { recursive: true })
    await fs.writeFile(at.file, "not json")
    const fresh = await pair.load(at.file)
    expect(pair.decode(fresh, pair.KeyBytes)).toBeDefined()
    expect(JSON.parse(await fs.readFile(at.file, "utf8"))).toStrictEqual({ v: 1, key: fresh })
    await fs.rm(at.root, { recursive: true, force: true })
  })

  test("builds the pairing URL the extension watches for", () => {
    const target = new URL(pair.url({ port: 47917, hubId: "6f1c2f7e-0d3f-4b1f-8a54-9d0e7a1c2b3d", key }))
    expect(target.host).toBe("127.0.0.1:47917")
    expect(target.pathname).toBe(pair.PairingPath)
    const fragment = new URLSearchParams(target.hash.slice(1))
    expect(fragment.get("v")).toBe("1")
    expect(fragment.get("hub")).toBe("6f1c2f7e-0d3f-4b1f-8a54-9d0e7a1c2b3d")
    expect(fragment.get("k")).toBe(key)
    expect(fragment.get("ws")).toBe("ws://127.0.0.1:47917" + pair.SocketPath)
  })

  test("opens the pairing page with the platform command", async () => {
    const seen: string[][] = []
    const exec = async (cmd: string[]) => {
      seen.push(cmd)
      return 0
    }
    await pair.opener({ platform: "darwin", exec })("http://127.0.0.1:1/x")
    await pair.opener({ platform: "linux", env: {}, exec })("http://127.0.0.1:1/x")
    await pair.opener({ platform: "win32", exec })("http://127.0.0.1:1/x")
    expect(seen).toStrictEqual([
      ["open", "http://127.0.0.1:1/x"],
      ["xdg-open", "http://127.0.0.1:1/x"],
      ["cmd.exe", "/c", "start", "", "http://127.0.0.1:1/x"],
    ])
  })

  test("falls back to cmd.exe when wslview is missing", async () => {
    const seen: string[][] = []
    const exec = async (cmd: string[]) => {
      seen.push(cmd)
      return cmd[0] === "wslview" ? 1 : 0
    }
    await pair.opener({ platform: "linux", env: { WSL_DISTRO_NAME: "Ubuntu" }, exec })("http://127.0.0.1:1/x")
    expect(seen).toStrictEqual([
      ["wslview", "http://127.0.0.1:1/x"],
      ["cmd.exe", "/c", "start", "", "http://127.0.0.1:1/x"],
    ])
  })

  test("uses an injected opener, which is how VS Code passes openExternal", async () => {
    const opened: string[] = []
    await pair.open("http://127.0.0.1:1/x", {
      opener: async (target) => {
        opened.push(target)
      },
    })
    expect(opened).toStrictEqual(["http://127.0.0.1:1/x"])
  })
})
