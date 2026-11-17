// Native messaging mode: the browser starts this process and speaks framed JSON on
// stdio. The hub is identical to loopback mode; only the extension transport differs.
import { Log } from "@opencode-ai/core/util/log"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import * as proto from "./protocol"
import { HostLimit, PeerLimit, decoder, write } from "./frame"
import { Paths } from "./paths"
import { Registry } from "./registry"
import { create } from "./hub"
import { serve } from "./socket"
import { caller, ids } from "./install"

const log = Log.create({ service: "browser.native" })

export type Run = {
  version?: string
  argv?: string[]
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  exit?: (code: number) => void
}

export async function run(input: Run = {}) {
  const version = input.version ?? InstallationVersion
  const stdin = input.stdin ?? process.stdin
  const stdout = input.stdout ?? process.stdout
  const leave = input.exit ?? ((code: number) => process.exit(code))

  if (!caller(input.argv ?? process.argv.slice(2), ids())) {
    // The browser passes the calling origin; refusing it here keeps a host that was
    // installed for one extension from serving another.
    log.error("refusing to start for an extension that is not allowed")
    leave(1)
    return
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
      void stop(0)
    },
  )

  // The first frame after the transport opens is always hub.hello.
  const hello: proto.HubHello = { type: "hub.hello", protocol: [proto.Protocol], hubVersion: version, mode: "native" }
  write(stdout, hello, HostLimit)

  const stopping = { done: false }
  // Resolved when the hub stops; the command handler awaits it so the process does
  // not exit while the browser still holds the port open.
  const finished = Promise.withResolvers<void>()
  async function stop(code: number) {
    if (stopping.done) return
    stopping.done = true
    hub.close("the hub is shutting down")
    await server.close().catch((error) => log.warn("cannot close the CLI socket", { error }))
    await Registry.remove(entry.hubId).catch((error) => log.warn("cannot remove the hub registry entry", { error }))
    finished.resolve()
    leave(code)
  }

  if (!link) {
    log.error("a second extension transport reached a native hub")
    await stop(1)
    return
  }

  const frames = decoder({
    limit: PeerLimit,
    onFrame(value) {
      const parsed = proto.ExtensionToHub.safeParse(value)
      if (!parsed.success) {
        log.error("invalid frame from the extension", { issues: parsed.error.issues })
        void stop(1)
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
      void stop(1)
    },
  })

  stdin.on("data", (chunk: Buffer | string) => frames.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk))
  stdin.on("end", () => void stop(0))
  stdin.on("close", () => void stop(0))
  stdin.on("error", (error) => {
    log.error("stdin failed", { error })
    void stop(1)
  })

  process.once("SIGTERM", () => void stop(0))
  process.once("SIGINT", () => void stop(0))
  return finished.promise
}
