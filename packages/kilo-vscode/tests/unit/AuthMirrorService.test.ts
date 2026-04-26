import { afterEach, describe, expect, it } from "bun:test"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { AuthMirrorService, getAuthJsonPath } from "../../src/auth/AuthMirrorService"
import { handleLogout } from "../../src/kilo-provider/handlers/auth"

class FakeSecrets {
  storeMap = new Map<string, string>()

  async get(key: string) {
    return this.storeMap.get(key)
  }

  async store(key: string, value: string) {
    this.storeMap.set(key, value)
  }

  async delete(key: string) {
    this.storeMap.delete(key)
  }
}

const roots: string[] = []

async function tempAuthPath() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kilo-auth-mirror-"))
  roots.push(root)
  return path.join(root, "auth.json")
}

async function makeService(authPath: string, options: ConstructorParameters<typeof AuthMirrorService>[2] = {}) {
  const secrets = new FakeSecrets()
  const service = new AuthMirrorService({ secrets }, authPath, options)
  return { secrets, service }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("AuthMirrorService", () => {
  it("resolves the CLI auth.json path from XDG data home", () => {
    expect(getAuthJsonPath({ XDG_DATA_HOME: "/tmp/data" }, "/home/user")).toBe("/tmp/data/kilo/auth.json")
  })

  it("migrateFileToSecretIfNeeded is a no-op on fresh installs", async () => {
    const authPath = await tempAuthPath()
    const { secrets, service } = await makeService(authPath)

    await service.migrateFileToSecretIfNeeded()

    expect(await secrets.get(AuthMirrorService.SECRET_KEY)).toBeUndefined()
  })

  it("migrateFileToSecretIfNeeded copies existing auth.json when SecretStorage is empty", async () => {
    const authPath = await tempAuthPath()
    const payload = JSON.stringify({ kilo: { type: "oauth", refresh: "r", access: "a", expires: 1 } })
    await fs.writeFile(authPath, payload)
    const { secrets, service } = await makeService(authPath)

    await service.migrateFileToSecretIfNeeded()

    expect(await secrets.get(AuthMirrorService.SECRET_KEY)).toBe(payload)
  })

  it("migrateFileToSecretIfNeeded does not overwrite an existing SecretStorage value", async () => {
    const authPath = await tempAuthPath()
    await fs.writeFile(authPath, "file-auth")
    const { secrets, service } = await makeService(authPath)
    await secrets.store(AuthMirrorService.SECRET_KEY, "secret-auth")

    await service.migrateFileToSecretIfNeeded()

    expect(await secrets.get(AuthMirrorService.SECRET_KEY)).toBe("secret-auth")
  })

  it("seedFileFromSecretIfNeeded hydrates missing auth.json and getCliEnvSeed returns KILO_AUTH_CONTENT", async () => {
    const authPath = await tempAuthPath()
    const { service } = await makeService(authPath)
    await service.writeSecret("secret-auth")

    expect(await service.getCliEnvSeed()).toEqual({ KILO_AUTH_CONTENT: "secret-auth" })
    await service.seedFileFromSecretIfNeeded()

    expect(await fs.readFile(authPath, "utf8")).toBe("secret-auth")
  })

  it("seedFileFromSecretIfNeeded does not overwrite populated auth.json", async () => {
    const authPath = await tempAuthPath()
    await fs.writeFile(authPath, "disk-auth")
    const { service } = await makeService(authPath)
    await service.writeSecret("secret-auth")

    await service.seedFileFromSecretIfNeeded()

    expect(await fs.readFile(authPath, "utf8")).toBe("disk-auth")
    expect(await service.getCliEnvSeed()).toEqual({})
  })

  it("file watcher syncs auth.json changes back to SecretStorage", async () => {
    const authPath = await tempAuthPath()
    let onChange: (() => void) | undefined
    const { service } = await makeService(authPath, {
      debounceMs: 10,
      watchAuthFile(change) {
        onChange = change
        return { dispose() {} }
      },
    })
    const watcher = service.startFileWatcher()

    await fs.writeFile(authPath, "rotated-auth")
    onChange?.()
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(await service.readSecret()).toBe("rotated-auth")
    watcher.dispose()
  })

  it("deletes SecretStorage on logout", async () => {
    const authPath = await tempAuthPath()
    const { service } = await makeService(authPath)
    await service.writeSecret("secret-auth")
    const messages: unknown[] = []

    await handleLogout({
      client: {
        auth: { remove: async () => ({}) },
      } as any,
      postMessage: (msg) => messages.push(msg),
      getWorkspaceDirectory: () => authPath,
      disposeGlobal: async () => {},
      fetchAndSendProviders: async () => {},
      fetchAndSendAgents: async () => {},
      deleteSecret: () => service.deleteSecret(),
    })

    expect(await service.readSecret()).toBeUndefined()
    expect(messages).toContainEqual({ type: "profileData", data: null })
  })
})
