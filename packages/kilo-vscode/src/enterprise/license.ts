import * as fs from "fs"
import * as vscode from "vscode"
import { verifyRsaSha256 } from "./license-crypto"
import { enterpriseSettings, type LicenseSettings } from "./settings"

const CACHE_KEY = "enterprise.license.cache"

export type LicenseCache = {
  token: string
  expiresAt: string
  verifiedAt: string
}

export type LicenseResult = {
  ok: boolean
  reason: string
  readonly?: boolean
}

type VerifyResponse = {
  valid?: boolean
  token?: string
  expiresAt?: string
  readonly?: boolean
  message?: string
}

type OfflineFile = {
  key?: string
  expiresAt?: string
  signature?: string
}

export async function ensureLicense(context: vscode.ExtensionContext): Promise<LicenseResult> {
  const settings = enterpriseSettings().license
  if (!settings.enabled) return { ok: true, reason: "disabled" }

  const offline = parseOfflineLicense(settings.offlinePath, settings.key, resolvePublicKey(settings))
  if (offline?.ok) return offline

  const cached = readCache(context, settings)
  if (cached?.ok) return cached.result

  const online = await verifyOnline(settings)
  if (online.ok && online.token) {
    writeCache(context, {
      token: online.token,
      expiresAt: online.expiresAt ?? hoursAhead(settings.cacheHours),
      verifiedAt: new Date().toISOString(),
    })
    return { ok: true, reason: "online", readonly: online.readonly }
  }

  const grace = graceFromCache(context, settings)
  if (grace) return grace

  return { ok: false, reason: online.reason || "verify_failed", readonly: true }
}

export function licenseBlocksConnect(result: LicenseResult): boolean {
  return !result.ok
}

function readCache(context: vscode.ExtensionContext, settings: LicenseSettings): { ok: true; result: LicenseResult } | null {
  const raw = context.globalState.get<LicenseCache>(CACHE_KEY)
  if (!raw?.expiresAt) return null
  const expires = Date.parse(raw.expiresAt)
  if (Number.isNaN(expires) || expires <= Date.now()) return null
  return { ok: true, result: { ok: true, reason: "cache", readonly: false } }
}

function graceFromCache(context: vscode.ExtensionContext, settings: LicenseSettings): LicenseResult | null {
  const raw = context.globalState.get<LicenseCache>(CACHE_KEY)
  if (!raw?.verifiedAt) return null
  const verified = Date.parse(raw.verifiedAt)
  if (Number.isNaN(verified)) return null
  const graceMs = settings.graceDays * 24 * 60 * 60 * 1000
  if (Date.now() - verified > graceMs) return null
  return { ok: true, reason: "grace", readonly: false }
}

function writeCache(context: vscode.ExtensionContext, cache: LicenseCache) {
  void context.globalState.update(CACHE_KEY, cache)
}

export function parseOfflineLicense(file: string, key: string, publicKey = ""): LicenseResult | null {
  const path = file.trim()
  if (!path || !fs.existsSync(path)) return null
  try {
    const data = JSON.parse(fs.readFileSync(path, "utf8")) as OfflineFile
    if (!data.expiresAt) return { ok: false, reason: "offline_missing_expires", readonly: true }
    const expires = Date.parse(data.expiresAt)
    if (Number.isNaN(expires) || expires <= Date.now()) {
      return { ok: false, reason: "offline_expired", readonly: true }
    }
    if (key && data.key && data.key !== key) {
      return { ok: false, reason: "offline_key_mismatch", readonly: true }
    }
    const sig = data.signature?.trim() ?? ""
    if (sig) {
      const pem = publicKey.trim()
      if (!pem) return { ok: false, reason: "offline_no_public_key", readonly: true }
      const licenseKey = data.key ?? key
      if (!licenseKey) return { ok: false, reason: "offline_missing_key", readonly: true }
      const ok = verifyRsaSha256({ key: licenseKey, expiresAt: data.expiresAt }, sig, pem)
      if (!ok) return { ok: false, reason: "offline_bad_signature", readonly: true }
      return { ok: true, reason: "offline_rsa", readonly: false }
    }
    return { ok: true, reason: "offline", readonly: false }
  } catch (err) {
    console.error("[Kilo New] Offline license read failed:", err)
    return { ok: false, reason: "offline_invalid", readonly: true }
  }
}

function resolvePublicKey(settings: LicenseSettings): string {
  if (settings.offlinePublicKey) return settings.offlinePublicKey
  const path = settings.offlinePublicKeyPath.trim()
  if (!path || !fs.existsSync(path)) return ""
  return fs.readFileSync(path, "utf8")
}

async function verifyOnline(settings: LicenseSettings): Promise<{
  ok: boolean
  reason: string
  token?: string
  expiresAt?: string
  readonly?: boolean
}> {
  const base = settings.serverUrl.replace(/\/+$/, "")
  if (!base) return { ok: false, reason: "no_license_server" }
  if (!settings.key) return { ok: false, reason: "no_license_key" }

  const url = `${base}/api/v1/license/verify`
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: settings.key,
        machineId: vscode.env.machineId,
        client: "vscode",
      }),
    })
    if (!res.ok) return { ok: false, reason: `http_${res.status}` }
    const body = (await res.json()) as VerifyResponse
    if (!body.valid) return { ok: false, reason: body.message ?? "invalid" }
    return {
      ok: true,
      reason: "verified",
      token: body.token ?? settings.key,
      expiresAt: body.expiresAt,
      readonly: body.readonly,
    }
  } catch (err) {
    console.error("[Kilo New] License verify request failed:", err)
    return { ok: false, reason: "network" }
  }
}

function hoursAhead(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}
