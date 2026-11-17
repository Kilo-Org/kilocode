// Native messaging mode: the browser starts this process and speaks framed JSON on
// stdio. The hub is identical to loopback mode; only the extension transport differs.
import { OPENCODE_VERSION } from "@opencode/cli/version"
import { Log } from "./log"
import * as proto from "./protocol"
import { HostLimit, PeerLimit, decoder, write } from "./frame"
import { Paths } from "./paths"
import { Registry } from "./registry"
import { create } from "./hub"
import { serve } from "./socket"
import { allowlist, caller, ids } from "./install"

const log = Log.create({ service: "browser.native" })

export type Run = {
  version?: string
  argv?: string[]
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
}

export type Running = {
  // Resolves when the hub stopped, for any reason.
  done: Promise<void>
  stop(): Promise<void>
}

export async function run(input: Run = {}): Promise<Running> {
  const version = input.version ?? OPENCODE_VERSION
  const stdin = input.stdin ?? process.stdin
  const stdout = input.stdout ?? process.stdout

  if (!caller(input.argv ?? process.argv.slice(2), (await allowlist()) ?? ids())) {
    // The browser passes the calling origin; refusing it here keeps a host that was
    // installed for one extension from serving another.
    throw new Error("refusing to start for an extension that is not allowed")
  }

  const hub = create({
    mode: "native",
    version,
    onChange(info) {
      void Registry.write({
        ...entry,
        browser: info?.browser ?? null,
        profileLabel: info?.profileLabel ?? null,
      }).catch((error) => log.warn("cannot update the hub registry entry", { error }))
    },
  })
  const entry = Registry.empty({ hubId: hub.id, mode: "native", socket: Paths.socket(hub.id) })

  const server = await serve({
    path: entry.socket,
    open(connection) {
      const controller = hub.join(
        (frame) => connection.send(frame),
        () => connection.close(),
      )
      connection.onClose(() => controller.drop())
      return (frame) => controller.frame(frame)
    },
  })
  await Registry.write(entry)

  const link = hub.attach(
    (frame) => write(stdout, frame, HostLimit),
    (reason) => {
      log.info("closing the extension transport", { reason })
      void stop()
    },
  )

  // The first frame after the transport opens is always hub.hello.
  const hello: proto.HubHello = { type: "hub.hello", protocol: [proto.Protocol], hubVersion: version, mode: "native" }
  write(stdout, hello, HostLimit)

  const stopping = { done: false }
  // Resolved when the hub stops; the command handler awaits it so the process does
  // not exit while the browser still holds the port open.
  const finished = Promise.withResolvers<void>()
  async function stop() {
    if (stopping.done) return
    stopping.done = true
    hub.close("the hub is shutting down")
    await server.close().catch((error) => log.warn("cannot close the CLI socket", { error }))
    await Registry.remove(entry.hubId).catch((error) => log.warn("cannot remove the hub registry entry", { error }))
    finished.resolve()
  }

  if (!link) {
    log.error("a second extension transport reached a native hub")
    await stop()
    throw new Error("a second extension transport reached a native hub")
  }

  const frames = decoder({
    limit: PeerLimit,
    onFrame(value) {
      const parsed = proto.ExtensionToHub.safeParse(value)
      if (!parsed.success) {
        log.error("invalid frame from the extension", { issues: parsed.error.issues })
        void stop()
        return
      }
      if (parsed.data.type === "ext.hello") {
        link.hello(parsed.data)
        return
      }
      link.frame(parsed.data)
    },
    onError(error) {
      log.error("framing error on stdin", { error })
      void stop()
    },
  })

  stdin.on("data", (chunk: Buffer | string) => frames.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk))
  stdin.on("end", () => void stop())
  stdin.on("close", () => void stop())
  stdin.on("error", (error) => {
    log.error("stdin failed", { error })
    void stop()
  })

  return { done: finished.promise, stop }
}
