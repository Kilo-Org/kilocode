import type { Plugin, AuthOuathResult } from "@kilocode/plugin"
import http from "http"
import open from "open"
import {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
} from "openid-client"
import { OCA_IDCS_CLIENT_ID, OCA_IDCS_URL, OCA_IDCS_SCOPES, OCA_CALLBACK_PORTS } from "./constants"
import { Log } from "../../util/log"

const log = Log.create({ service: "oca-auth" })

const TIMEOUT_MS = 300_000

type TokenResult = { type: "success"; refresh: string; access: string; expires: number } | { type: "failed" }

async function discover(attempt = 0): ReturnType<typeof discovery> {
  const config = await discovery(new URL(OCA_IDCS_URL), OCA_IDCS_CLIENT_ID).catch((err) => {
    log.error("OIDC discovery failed", { attempt, error: err })
    return undefined
  })
  if (config) return config
  if (attempt >= 2) throw new Error("OIDC discovery failed after 3 attempts")
  const delay = Math.pow(2, attempt) * 1000
  await new Promise((r) => setTimeout(r, delay))
  return discover(attempt + 1)
}

function startServer(
  ports: number[],
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ server: http.Server; port: number }> {
  const remaining = [...ports]

  function attempt(): Promise<{ server: http.Server; port: number }> {
    const port = remaining.shift()
    if (port === undefined) return Promise.reject(new Error("no available callback ports"))
    const srv = http.createServer(handler)
    return new Promise((resolve, reject) => {
      srv.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          log.info("port in use, trying next", { port })
          return resolve(attempt())
        }
        reject(err)
      })
      srv.listen(port, "127.0.0.1", () => resolve({ server: srv, port }))
    })
  }

  return attempt()
}

async function authenticateWithOcaSSO(): Promise<AuthOuathResult> {
  const config = await discover()
  const verifier = randomPKCECodeVerifier()
  const challenge = await calculatePKCECodeChallenge(verifier)

  const deferred: { resolve: (value: TokenResult) => void } = { resolve: () => {} }
  const pending = new Promise<TokenResult>((resolve) => {
    deferred.resolve = resolve
  })

  const { server, port } = await startServer(OCA_CALLBACK_PORTS, (req, res) => {
    const parsed = new URL(req.url ?? "/", `http://127.0.0.1:${port}`)
    if (parsed.pathname !== "/callback") {
      res.writeHead(404)
      res.end("Not found")
      return
    }

    const callback = new URL(`http://127.0.0.1:${port}${req.url}`)
    authorizationCodeGrant(config, callback, {
      pkceCodeVerifier: verifier,
    })
      .then((tokens) => {
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end("Authentication successful! You can close this window.")
        const expires = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : Date.now() + 3600 * 1000
        deferred.resolve({
          type: "success",
          refresh: tokens.refresh_token ?? "",
          access: tokens.access_token,
          expires,
        })
      })
      .catch((err) => {
        log.error("token exchange failed", { error: err })
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end("Authentication failed.")
        deferred.resolve({ type: "failed" })
      })
      .finally(() => {
        server.close()
      })
  })

  const redirect = `http://127.0.0.1:${port}/callback`
  const url = buildAuthorizationUrl(config, {
    redirect_uri: redirect,
    scope: OCA_IDCS_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    response_type: "code",
    client_id: OCA_IDCS_CLIENT_ID,
  })

  await open(url.href)

  return {
    url: url.href,
    instructions: "Complete Oracle SSO login in your browser.",
    method: "auto" as const,
    callback: () => {
      const timeout = new Promise<TokenResult>((resolve) => {
        setTimeout(() => {
          server.close()
          resolve({ type: "failed" })
        }, TIMEOUT_MS)
      })
      return Promise.race([pending, timeout])
    },
  }
}

export const OcaAuthPlugin: Plugin = async (_ctx) => {
  return {
    auth: {
      provider: "oca",
      async loader(getAuth) {
        const auth = await getAuth()
        if (!auth) return {}
        if (auth.type === "oauth") {
          return {
            apiKey: auth.access,
          }
        }
        return {}
      },
      methods: [
        {
          type: "oauth",
          label: "Oracle Code Assist (Oracle SSO)",
          async authorize() {
            return await authenticateWithOcaSSO()
          },
        },
      ],
    },
  }
}
