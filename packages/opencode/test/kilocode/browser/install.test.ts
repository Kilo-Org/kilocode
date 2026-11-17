import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { caller, ids, install, manifest, script, targets } from "../../../src/kilocode/browser/install"
import { FirefoxExtensionId, HostName, StoreExtensionId } from "../../../src/kilocode/browser/protocol"

const data = "/kilo/data"
const file = `${HostName}.json`

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "kilo-install-"))
}

describe("native host manifests", () => {
  test("lists every Chromium browser and Firefox on macOS", () => {
    const list = targets({ platform: "darwin", home: "/Users/kilo", config: "/Users/kilo/.config", data })
    const mac = path.join("/Users/kilo", "Library/Application Support")
    expect(list.map((target) => target.browser)).toContain("Chrome")
    expect(list.find((target) => target.browser === "Chrome")?.file).toBe(
      path.join(mac, "Google/Chrome/NativeMessagingHosts", file),
    )
    expect(list.find((target) => target.browser === "Brave")?.file).toBe(
      path.join(mac, "BraveSoftware/Brave-Browser/NativeMessagingHosts", file),
    )
    expect(list.find((target) => target.browser === "Firefox")?.file).toBe(
      path.join(mac, "Mozilla/NativeMessagingHosts", file),
    )
    expect(list.filter((target) => target.kind === "chromium")).toHaveLength(9)
    expect(list.every((target) => target.key === undefined)).toBe(true)
  })

  test("uses the XDG config dir and both Firefox locations on Linux", () => {
    const list = targets({ platform: "linux", home: "/home/kilo", config: "/home/kilo/.config", data })
    expect(list.find((target) => target.browser === "Chrome")?.file).toBe(
      path.join("/home/kilo/.config", "google-chrome/NativeMessagingHosts", file),
    )
    expect(list.find((target) => target.browser === "Opera")?.file).toBe(
      path.join("/home/kilo/.config", "opera/NativeMessagingHosts", file),
    )
    expect(list.find((target) => target.browser === "Firefox")?.file).toBe(
      path.join("/home/kilo", ".mozilla/native-messaging-hosts", file),
    )
    expect(list.find((target) => target.browser === "Firefox (snap)")?.file).toBe(
      path.join("/home/kilo", "snap/firefox/common/.mozilla/native-messaging-hosts", file),
    )
  })

  test("registers HKCU keys and manifest files on Windows", () => {
    const list = targets({ platform: "win32", home: "C:\\Users\\kilo", config: "C:\\Users\\kilo\\.config", data })
    expect(list.find((target) => target.browser === "Chrome")?.key).toBe(
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HostName}`,
    )
    expect(list.find((target) => target.browser === "Edge")?.key).toBe(
      `HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\${HostName}`,
    )
    expect(list.find((target) => target.kind === "firefox")?.key).toBe(
      `HKCU\\Software\\Mozilla\\NativeMessagingHosts\\${HostName}`,
    )
    expect(list.every((target) => target.file.startsWith(path.join(data, "manifests")))).toBe(true)
  })

  test("allows the store extension and test ids through allowed_origins", () => {
    const body = manifest({ kind: "chromium", target: "/kilo/host", allowed: [StoreExtensionId, "a".repeat(32)] })
    expect(body.allowed_origins).toStrictEqual([
      `chrome-extension://${StoreExtensionId}/`,
      `chrome-extension://${"a".repeat(32)}/`,
    ])
    expect(body.path).toBe("/kilo/host")
    expect(body.type).toBe("stdio")
  })

  test("allows the Gecko id through allowed_extensions", () => {
    const body = manifest({ kind: "firefox", target: "/kilo/host", allowed: [StoreExtensionId] })
    expect(body.allowed_extensions).toStrictEqual([FirefoxExtensionId])
  })

  test("reads extra test extension ids from the environment", () => {
    const extra = "b".repeat(32)
    expect(ids({ KILO_BROWSER_EXTRA_EXTENSION_IDS: `${extra}, not-an-id ,` })).toStrictEqual([
      StoreExtensionId,
      extra,
    ])
    expect(ids({})).toStrictEqual([StoreExtensionId])
  })

  test("refuses a caller origin that is not allowed", () => {
    const allowed = [StoreExtensionId]
    expect(caller([`chrome-extension://${StoreExtensionId}/`], allowed)).toBe(true)
    expect(caller([`chrome-extension://${"c".repeat(32)}/`], allowed)).toBe(false)
    expect(caller(["/path/manifest.json", FirefoxExtensionId], allowed)).toBe(true)
    expect(caller(["--parent-window=0"], allowed)).toBe(true)
    expect(caller([], allowed)).toBe(true)
  })

  test("writes a shim that forwards the browser arguments", () => {
    const posix = script({ platform: "darwin", command: ["/opt/my kilo/kilo"] })
    expect(posix.startsWith("#!/bin/sh")).toBe(true)
    expect(posix).toContain('exec "/opt/my kilo/kilo" browser-hub --native "$@"')
    const win = script({ platform: "win32", command: ["C:\\kilo\\kilo.exe"] })
    expect(win).toContain('"C:\\kilo\\kilo.exe" browser-hub --native %*')
  })
})

describe("native host install", () => {
  test("is idempotent and points every manifest at the shim", async () => {
    const root = await tmp()
    const home = path.join(root, "home")
    const at = path.join(root, "data")
    const first = await install({ platform: "darwin", home, config: path.join(home, ".config"), data: at, command: ["/bin/kilo"] })
    const before = await Promise.all(first.files.map((item) => fs.readFile(item, "utf8")))

    const second = await install({ platform: "darwin", home, config: path.join(home, ".config"), data: at, command: ["/bin/kilo"] })
    const after = await Promise.all(second.files.map((item) => fs.readFile(item, "utf8")))
    expect(after).toStrictEqual(before)
    expect(second.shim).toBe(first.shim)

    const shim = await fs.readFile(first.shim, "utf8")
    expect(shim).toContain('exec "/bin/kilo" browser-hub --native "$@"')
    const stat = await fs.stat(first.shim)
    expect(stat.isFile()).toBe(true)
    // Windows has no execute bits; the shim is a .cmd file there.
    if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o755)

    const entry = JSON.parse(before[0] ?? "{}")
    expect(entry.name).toBe(HostName)
    expect(entry.path).toBe(first.shim)
    expect(entry.allowed_origins).toStrictEqual([`chrome-extension://${StoreExtensionId}/`])
    expect(first.keys).toStrictEqual([])
    await fs.rm(root, { recursive: true, force: true })
  })

  test("registers Windows keys with reg.exe", async () => {
    const root = await tmp()
    const commands: string[][] = []
    const result = await install({
      platform: "win32",
      home: path.join(root, "home"),
      config: path.join(root, "home", ".config"),
      data: path.join(root, "data"),
      command: ["C:\\kilo\\kilo.exe"],
      exec: async (cmd) => {
        commands.push(cmd)
      },
    })
    expect(result.keys.length).toBe(result.files.length)
    expect(commands.every((cmd) => cmd[0] === "reg.exe" && cmd.includes("/f"))).toBe(true)
    expect(commands[0]).toStrictEqual([
      "reg.exe",
      "add",
      `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HostName}`,
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      result.files[0],
      "/f",
    ])
    await fs.rm(root, { recursive: true, force: true })
  })
})
