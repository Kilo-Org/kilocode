import * as http from "http"
import * as https from "https"
import { URL } from "url"

/** Fixed Basic password Kilo uses when talking to the local proxy. */
export const PROXY_PASSWORD = "yoyo-local-proxy"

export type ProxyHandle = {
  port: number
  close: () => Promise<void>
}

function basicOk(header: string | undefined, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false
  const raw = Buffer.from(header.slice(6), "base64").toString("utf8")
  const colon = raw.indexOf(":")
  const user = colon >= 0 ? raw.slice(0, colon) : raw
  const pass = colon >= 0 ? raw.slice(colon + 1) : ""
  return user === "kilo" && pass === password
}

function upstreamRequest(
  upstream: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
) {
  const path = req.url ?? "/"
  const target = new URL(path, upstream)
  const mod = target.protocol === "https:" ? https : http

  const headers = { ...req.headers }
  delete headers.host
  delete headers.connection
  headers.authorization = `Bearer ${token}`

  const proxy = mod.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers)
      up.pipe(res)
    },
  )

  proxy.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
      res.end(`Proxy upstream error: ${err.message}`)
      return
    }
    res.end()
  })

  req.pipe(proxy)
}

export function startProxy(input: {
  upstream: string
  token: string
  port?: number
  password?: string
}): Promise<ProxyHandle> {
  const upstream = new URL(input.upstream.endsWith("/") ? input.upstream : `${input.upstream}/`)
  const password = input.password ?? PROXY_PASSWORD

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!basicOk(req.headers.authorization, password)) {
        res.writeHead(401, { "content-type": "text/plain; charset=utf-8" })
        res.end("Unauthorized: complete 驭码 SSO login first")
        return
      }
      if (!input.token) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
        res.end("No JWT: complete 驭码 SSO login first")
        return
      }
      upstreamRequest(upstream, req, res, input.token)
    })

    server.on("error", reject)

    const listen = (port: number) => {
      server.listen(port, "127.0.0.1", () => {
        const addr = server.address()
        const bound = typeof addr === "object" && addr ? addr.port : port
        resolve({
          port: bound,
          close: () =>
            new Promise((done, err) => {
              server.close((e) => (e ? err(e) : done()))
            }),
        })
      })
    }

    if (input.port && input.port > 0) {
      listen(input.port)
      return
    }

    listen(0)
  })
}
