// Shared helpers for the browser bridge integration tests: a framed inbox for a
// child process stream, matched by schema.
import z from "zod"
import { PeerLimit, decoder } from "../../../src/kilocode/browser/frame"
import * as proto from "../../../src/kilocode/browser/protocol"

type Waiter = {
  match(value: unknown): boolean
  settle(value: unknown): void
  fail(error: Error): void
}

export type Inbox = {
  take<T>(schema: z.ZodType<T>, timeout?: number): Promise<T>
  errors(): Error[]
}

export function inbox(stream: NodeJS.ReadableStream): Inbox {
  const values: unknown[] = []
  const waiters: Waiter[] = []
  const failures: Error[] = []

  const offer = (value: unknown) => {
    const index = waiters.findIndex((waiter) => waiter.match(value))
    const waiter = index < 0 ? undefined : waiters.splice(index, 1)[0]
    if (waiter) waiter.settle(value)
    else values.push(value)
  }

  const frames = decoder({
    limit: PeerLimit,
    onFrame: offer,
    onError: (error) => failures.push(error),
  })
  stream.on("data", (chunk: Buffer | string) => frames.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk))

  return {
    take<T>(schema: z.ZodType<T>, timeout = 5_000) {
      const index = values.findIndex((value) => schema.safeParse(value).success)
      if (index >= 0) return Promise.resolve(schema.parse(values.splice(index, 1)[0]))
      const deferred = Promise.withResolvers<T>()
      const waiter: Waiter = {
        match: (value) => schema.safeParse(value).success,
        settle: (value) => deferred.resolve(schema.parse(value)),
        fail: deferred.reject,
      }
      waiters.push(waiter)
      const timer = setTimeout(() => {
        const at = waiters.indexOf(waiter)
        if (at >= 0) waiters.splice(at, 1)
        deferred.reject(new Error("timed out waiting for a frame"))
      }, timeout)
      void deferred.promise.finally(() => clearTimeout(timer)).catch(() => undefined)
      return deferred.promise
    },
    errors() {
      return failures
    },
  }
}

export function extensionHello(input: { profileLabel?: string } = {}): proto.ExtHello {
  return {
    type: "ext.hello",
    protocol: [1],
    extensionVersion: "1.0.0",
    browser: { name: "Chrome", version: "140.0.0.0" },
    profileLabel: input.profileLabel ?? "Default",
    contractSha: "deadbeef",
    capabilities: {
      trustedInput: true,
      console: true,
      network: true,
      dialogs: true,
      fileUpload: true,
      tabGroups: true,
    },
  }
}

// Integration tests talk to a real child process and the filesystem, so a bounded
// poll is the only way to observe "registered" or "started"; keep it rare.
export async function until<T>(check: () => Promise<T | undefined> | T | undefined, timeout = 5_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value !== undefined) return value
    await Bun.sleep(50)
  }
  throw new Error("condition not met before the deadline")
}
