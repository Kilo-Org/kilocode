/// <reference lib="es2024.promise" />
import type { KiloClient } from "../v2/client.js"

type Route = { requestID: string; sessionID: string; directory: string }
type Status = "pending" | "missing" | "unknown"
const writes = new WeakMap<KiloClient, Map<string, { running: boolean; uncertain: boolean }>>()
const key = (route: Route) => JSON.stringify([route.directory, route.sessionID, route.requestID])

/** Check the original directory without submitting or repeating a permission decision. */
export async function permissionStatus(client: KiloClient, route: Route, timeout = 10_000): Promise<Status> {
  try {
    const { data } = await client.permission.list(
      { directory: route.directory },
      { throwOnError: true, signal: AbortSignal.timeout(timeout) },
    )
    if (
      !Array.isArray(data) ||
      data.some((item) => !item || typeof item.id !== "string" || typeof item.sessionID !== "string")
    )
      return "unknown"
    const records = writes.get(client)
    const record = records?.get(key(route))
    if (data.some((item) => item.id === route.requestID && item.sessionID === route.sessionID)) {
      return record ? "unknown" : "pending"
    }
    if (record?.uncertain && !record.running) records?.delete(key(route))
    return "missing"
  } catch {
    // A failed check cannot establish whether the server accepted an earlier response.
    return "unknown"
  }
}

/**
 * Bound the caller's wait, not the write. Reuse the same client for status checks and retries.
 * A late HTTP result permits recovery; a lost connection remains uncertain until the request
 * is absent. Pending status alone cannot prove that a server-side rule save has finished.
 */
export async function respondToPermission(
  client: KiloClient,
  input: Route & {
    reply: "once" | "always" | "reject"
    approvedAlways: string[]
    deniedAlways: string[]
    message?: string
  },
  timeout = 15_000,
): Promise<{ status: Status | "answered"; error?: unknown }> {
  const status = await permissionStatus(client, input)
  if (status !== "pending") return { status }
  const records = writes.get(client) ?? new Map<string, { running: boolean; uncertain: boolean }>()
  writes.set(client, records)
  const id = key(input)
  if (records.has(id)) return { status: "unknown" }
  const record = { running: false, uncertain: false }
  records.set(id, record)

  async function wait(action: () => Promise<unknown>) {
    record.running = true
    let detached = false
    const deadline = Promise.withResolvers<false>()
    const timer = setTimeout(() => deadline.resolve(false), timeout)
    const promise = Promise.resolve()
      .then(action)
      .then(
        () => true,
        (error: unknown) => {
          // Without an HTTP response, even a rejected fetch may leave server work running.
          const cause = error instanceof Error ? error.cause : undefined
          record.uncertain = !(
            cause &&
            typeof cause === "object" &&
            "status" in cause &&
            typeof cause.status === "number"
          )
          throw error
        },
      )
      .finally(() => {
        record.running = false
        if (detached && !record.uncertain && records.get(id) === record) records.delete(id)
      })
    try {
      const completed = await Promise.race([promise, deadline.promise])
      detached = !completed
      return completed
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    if (input.approvedAlways.length || input.deniedAlways.length) {
      const completed = await wait(() =>
        client.permission.saveAlwaysRules(
          {
            requestID: input.requestID,
            directory: input.directory,
            approvedAlways: input.approvedAlways,
            deniedAlways: input.deniedAlways,
          },
          { throwOnError: true },
        ),
      )
      // A late save may finish, but must never continue to approval automatically.
      if (!completed) return { status: await permissionStatus(client, input) }
    }
    const completed = await wait(() =>
      client.permission.reply(
        {
          requestID: input.requestID,
          directory: input.directory,
          reply: input.reply,
          interactive: true,
          ...(input.message ? { message: input.message } : {}),
        },
        { throwOnError: true },
      ),
    )
    if (!completed) return { status: await permissionStatus(client, input) }
    return { status: "answered" }
  } catch (error) {
    // Never automatically retry a write, including a save that may still finish on the server.
    if (!record.running && !record.uncertain && records.get(id) === record) records.delete(id)
    return { status: await permissionStatus(client, input), error }
  } finally {
    if (!record.running && !record.uncertain && records.get(id) === record) records.delete(id)
  }
}
