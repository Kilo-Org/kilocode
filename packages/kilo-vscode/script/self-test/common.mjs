import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

export const root = resolve(import.meta.dirname, "..", "..")
export const repo = resolve(root, "..", "..")
export const stateDir = join(repo, ".kilo", "vscode-self-test")
export const statePath = join(stateDir, "state.json")
export const logPath = join(stateDir, "daemon.log")

export function ensureStateDir() {
  mkdirSync(stateDir, { recursive: true })
}

export function readState() {
  if (!existsSync(statePath)) {
    return null
  }

  return JSON.parse(readFileSync(statePath, "utf8"))
}

export function writeState(value) {
  ensureStateDir()
  writeFileSync(statePath, JSON.stringify(value, null, 2) + "\n")
}

export function removeState() {
  rmSync(statePath, { force: true })
}

export function token() {
  return randomUUID().replaceAll("-", "")
}

export function output(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n")
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function isAlive(pid) {
  if (!pid) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function url(value) {
  return `http://127.0.0.1:${value.port}`
}

function headers(state) {
  return {
    "content-type": "application/json",
    "x-kilo-self-test-token": state.token,
  }
}

export async function ping(state) {
  if (!state) {
    return null
  }

  const response = await fetch(`${url(state)}/status`, {
    headers: headers(state),
  }).catch(() => null)

  if (!response?.ok) {
    return null
  }

  return response.json()
}

export async function request(state, route, body) {
  const response = await fetch(`${url(state)}${route}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: headers(state),
    method: body ? "POST" : "GET",
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(data.error ?? `${route} failed with ${response.status}`)
  }

  return data
}
