import { timingSafeEqual, randomBytes } from "node:crypto"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { createServer, request as requestHttp, type IncomingHttpHeaders, type Server } from "node:http"
import { request as requestHttps } from "node:https"
import { connect, createServer as createNetServer, type Socket } from "node:net"
import os from "node:os"
import path from "node:path"
import { Context, Effect, PlatformError } from "effect"
import { normalizeDestinations, parseDestination, resolveDestination } from "./destination"
import type { Profile } from "./profile"
import { TlsClientHello } from "./tls-client-hello"

export interface ProxyRuntime {
  readonly url: string
  readonly token: string
  readonly allowedHosts: ReadonlyArray<string>
  readonly port?: number | undefined
  readonly socket?: string | undefined
}

export const CurrentProxy = Context.Reference<ProxyRuntime | undefined>("@kilocode/sandbox/CurrentProxy", {
  defaultValue: () => undefined,
})

export const currentProxy: Effect.Effect<ProxyRuntime | undefined> = Effect.gen(function* () {
  return yield* CurrentProxy
})

export type ProxyResolver = typeof resolveDestination
export type ProxyFactory = (
  input: ReadonlyArray<string>,
) => Promise<ProxyRuntime & { readonly close: () => Promise<void> }>

export const CurrentProxyFactory = Context.Reference<ProxyFactory>("@kilocode/sandbox/CurrentProxyFactory", {
  defaultValue: () => startProxy,
})

function error(method: string, description: string, cause?: unknown) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method,
    pathOrDescriptor: "network",
    description,
    cause,
  })
}

function authenticate(value: string | undefined, token: string) {
  const match = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value ?? "")
  if (!match) return false
  const decoded = Buffer.from(match[1], "base64").toString("utf8")
  const separator = decoded.indexOf(":")
  if (separator < 1) return false
  const actual = Buffer.from(decoded.slice(separator + 1))
  const expected = Buffer.from(token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function headers(input: IncomingHttpHeaders, host?: string) {
  const connection = new Set((input.connection ?? "").split(",").map((value) => value.trim().toLowerCase()))
  const blocked = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    ...connection,
  ])
  return Object.fromEntries(
    Object.entries({ ...input, ...(host ? { host } : {}) }).filter(
      ([key, value]) => value !== undefined && !blocked.has(key.toLowerCase()),
    ),
  )
}

function shutdown(server: Server | ReturnType<typeof createNetServer>, sockets: Set<Socket>) {
  return new Promise<void>((resolve) => {
    for (const socket of sockets) socket.destroy()
    server.close(() => resolve())
  })
}

export async function startProxy(
  input: ReadonlyArray<string>,
  platform: NodeJS.Platform = process.platform,
  resolve: ProxyResolver = resolveDestination,
): Promise<ProxyRuntime & { readonly close: () => Promise<void> }> {
  const allowed = new Set(normalizeDestinations(input))
  const allowedHosts = [...allowed]
  const token = randomBytes(24).toString("base64url")
  const sockets = new Set<Socket>()
  const server = createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 30_000 })
  server.on("connection", (socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
  })
  server.on("connect", (request, client, head) => {
    client.on("error", () => undefined)
    if (!authenticate(request.headers["proxy-authorization"], token)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="kilo"\r\n\r\n')
      return
    }
    try {
      const dest = parseDestination(request.url ?? "")
      if (!allowed.has(dest.authority)) {
        client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
        return
      }
      const hello = new TlsClientHello(dest.host)
      let upstream: Socket | undefined
      let dialing = false
      let connected = false
      let tunneled = false
      const fail = () => {
        clearTimeout(timer)
        upstream?.destroy()
        client.destroy()
      }
      const timer = setTimeout(fail, 30_000)
      timer.unref()
      const forward = () => {
        if (!upstream || !connected || tunneled || client.destroyed || hello.push(Buffer.alloc(0)) !== "valid") return
        clearTimeout(timer)
        client.pause()
        client.off("data", inspect)
        tunneled = true
        upstream.pipe(client)
        const pipe = () => {
          if (!upstream || client.destroyed) {
            upstream?.destroy()
            return
          }
          client.pipe(upstream)
        }
        if (upstream.write(hello.bytes())) pipe()
        else upstream.once("drain", pipe)
      }
      const inspect = (chunk: Buffer) => {
        const state = hello.push(chunk)
        if (state === "invalid") {
          fail()
          return
        }
        if (dialing) {
          if (state === "valid") forward()
          return
        }
        if (state === "pending") return
        dialing = true
        void resolve(dest).then((resolved) => {
          if (client.destroyed) return
          upstream = connect({ host: resolved.address, port: dest.port, family: resolved.family })
          upstream.on("error", fail)
          upstream.once("connect", () => {
            if (!upstream || client.destroyed) {
              upstream?.destroy()
              return
            }
            connected = true
            forward()
          })
        }, fail)
      }
      client.on("data", inspect)
      client.once("end", () => {
        if (!tunneled) fail()
      })
      client.once("close", () => {
        clearTimeout(timer)
        upstream?.destroy()
      })
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) inspect(head)
    } catch {
      client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n")
    }
  })
  server.on("request", async (request, response) => {
    if (!authenticate(request.headers["proxy-authorization"], token)) {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="kilo"' })
      response.end()
      return
    }
    try {
      const url = new URL(request.url ?? "")
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new Error()
      const dest = parseDestination(`${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`)
      if (!allowed.has(dest.authority)) {
        response.writeHead(403)
        response.end()
        return
      }
      const resolved = await resolve(dest)
      const send = url.protocol === "https:" ? requestHttps : requestHttp
      const upstream = send(
        {
          hostname: resolved.address,
          family: resolved.family,
          port: dest.port,
          servername: dest.host,
          method: request.method,
          path: `${url.pathname}${url.search}`,
          headers: headers(request.headers, url.host),
        },
        (incoming) => {
          response.writeHead(incoming.statusCode ?? 502, headers(incoming.headers))
          incoming.pipe(response)
        },
      )
      upstream.on("error", () => {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      })
      response.once("close", () => upstream.destroy())
      request.pipe(upstream)
    } catch {
      response.writeHead(400)
      response.end()
    }
  })
  server.on("clientError", (_cause, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"))

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : undefined
  if (!port) throw new Error("Sandbox proxy did not bind a TCP port")

  const dir = platform === "linux" ? await mkdtemp(path.join(os.tmpdir(), "kilo-sandbox-proxy-")) : undefined
  const socket = dir ? path.join(dir, "proxy.sock") : undefined
  const bridgeSockets = new Set<Socket>()
  const bridge = socket
    ? createNetServer((client) => {
        bridgeSockets.add(client)
        client.once("close", () => bridgeSockets.delete(client))
        const upstream = connect({ host: "127.0.0.1", port })
        bridgeSockets.add(upstream)
        upstream.once("close", () => bridgeSockets.delete(upstream))
        client.on("error", () => upstream.destroy())
        upstream.on("error", () => client.destroy())
        client.pipe(upstream)
        upstream.pipe(client)
      })
    : undefined
  if (bridge && socket) {
    await new Promise<void>((resolve, reject) => {
      bridge.once("error", reject)
      bridge.listen(socket, () => {
        bridge.off("error", reject)
        resolve()
      })
    }).catch(async (cause) => {
      await shutdown(server, sockets)
      if (dir) await rm(dir, { recursive: true, force: true })
      throw cause
    })
    await chmod(socket, 0o600)
  }
  const url = `http://kilo:${encodeURIComponent(token)}@127.0.0.1:${port}`
  return {
    url,
    token,
    allowedHosts,
    port,
    socket,
    close: async () => {
      if (bridge) await shutdown(bridge, bridgeSockets)
      await shutdown(server, sockets)
      if (dir) await rm(dir, { recursive: true, force: true })
    },
  }
}

export function withProxy<A, E, R>(profile: Profile, effect: Effect.Effect<A, E, R>) {
  if (profile.network.mode !== "proxy" && profile.network.allowedHosts.length > 0) {
    return Effect.fail(error("validateProxy", "Sandbox allowedHosts require proxy network mode"))
  }
  if (profile.network.mode !== "proxy") {
    return effect.pipe(Effect.provideService(CurrentProxy, undefined))
  }
  return Effect.flatMap(CurrentProxyFactory, (factory) =>
    Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => factory(profile.network.allowedHosts),
        catch: (cause) => error("startProxy", "Could not start the sandbox network proxy", cause),
      }),
      (runtime) => effect.pipe(Effect.provideService(CurrentProxy, runtime)),
      (runtime) => Effect.promise(() => runtime.close()).pipe(Effect.ignore),
    ),
  )
}
