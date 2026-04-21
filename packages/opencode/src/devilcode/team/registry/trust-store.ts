import fs from "fs/promises"
import path from "path"
import os from "os"

export interface TrustedPublisher {
  publicKey: string
  addedAt: string
  comment?: string
}

export interface TrustStore {
  version: "1.0"
  publishers: Record<string, TrustedPublisher>
}

export const TRUST_STORE_PATH = path.join(os.homedir(), ".local", "share", "kilo", "registry", "trusted-publishers.json")

function emptyStore(): TrustStore {
  return { version: "1.0", publishers: {} }
}

export async function loadTrustStore(storePath = TRUST_STORE_PATH): Promise<TrustStore> {
  try {
    const raw = await fs.readFile(storePath, "utf-8")
    return JSON.parse(raw) as TrustStore
  } catch (err: unknown) {
    // File not found or malformed JSON — return empty store
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyStore()
    }
    if (err instanceof SyntaxError) {
      return emptyStore()
    }
    // Other errors (e.g. permissions) — recover gracefully
    return emptyStore()
  }
}

export async function saveTrustStore(store: TrustStore, storePath = TRUST_STORE_PATH): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true })
  await fs.writeFile(storePath, JSON.stringify(store, null, 2), "utf-8")
}

export async function addTrustedPublisher(
  publisherId: string,
  publicKey: string,
  comment?: string,
  storePath = TRUST_STORE_PATH,
): Promise<void> {
  const store = await loadTrustStore(storePath)
  store.publishers[publisherId] = { publicKey, addedAt: new Date().toISOString(), comment }
  await saveTrustStore(store, storePath)
}

export async function removeTrustedPublisher(publisherId: string, storePath = TRUST_STORE_PATH): Promise<boolean> {
  const store = await loadTrustStore(storePath)
  if (!(publisherId in store.publishers)) return false
  delete store.publishers[publisherId]
  await saveTrustStore(store, storePath)
  return true
}

export async function getTrustedPublisher(
  publisherId: string,
  storePath = TRUST_STORE_PATH,
): Promise<TrustedPublisher | undefined> {
  const store = await loadTrustStore(storePath)
  return store.publishers[publisherId]
}

export async function listTrustedPublishers(
  storePath = TRUST_STORE_PATH,
): Promise<Array<{ id: string } & TrustedPublisher>> {
  const store = await loadTrustStore(storePath)
  return Object.entries(store.publishers).map(([id, publisher]) => ({ id, ...publisher }))
}
