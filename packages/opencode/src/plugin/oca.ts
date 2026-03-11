// kilocode_change - new file
import http from "http"
import type { Hooks, PluginInput } from "@kilocode/plugin"
import { Installation } from "@/installation"

const IDCS_CLIENT_ID = "OCACodeAssistExtensionClientAppId"
const IDCS_URL = "https://idcs-73791a9208ad4aabafe8ad300d168f0c.identity.oraclecloud.com"
const IDCS_SCOPES = "urn:opc:resource:consumer::all openid offline_access"
const PORT_CANDIDATES = [8669, 8668, 8667]
const DEFAULT_OCA_BASE_URL = "https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com"

function redirectUri(port: number) {
  return `http://localhost:${port}/callback`
}

async function tryListen(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE") {
        reject(err)
        return
      }
      reject(err)
    })
    server.listen(port, "localhost", () => resolve(server))
  })
}

export async function OcaAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "oca",
      async loader(getAuth) {
        const info = await getAuth()
        if (!info || info.type !== "oauth") return {}
        return {
          apiKey: info.access,
          baseURL: `${process.env.OCA_API_BASE ?? DEFAULT_OCA_BASE_URL}/v1`,
          headers: {
            client: "kilo",
            "client-version": Installation.VERSION,
          },
          async fetch(request: RequestInfo | URL, init?: RequestInit) {
            const auth = await getAuth()
            if (auth.type !== "oauth") return fetch(request, init)
            const headers = new Headers(init?.headers)
            headers.set("Authorization", `Bearer ${auth.access}`)
            headers.set("client", "kilo")
            headers.set("client-version", Installation.VERSION)
            return fetch(request, { ...init, headers })
          },
        }
      },
      methods: [
        {
          type: "oauth",
          label: "Login with Oracle SSO",
          async authorize() {
            // Dynamic import openid-client to avoid bundling issues
            const {
              discovery,
              buildAuthorizationUrl,
              authorizationCodeGrant,
              randomPKCECodeVerifier,
              calculatePKCECodeChallenge,
            } = await import("openid-client")

            const discoveryUrl = new URL(`${IDCS_URL}/.well-known/openid-configuration`)
            const config = await discovery(discoveryUrl, IDCS_CLIENT_ID)

            const verifier = randomPKCECodeVerifier()
            const challenge = await calculatePKCECodeChallenge(verifier)

            // Find an available port
            let server: http.Server | undefined
            let port = 0
            for (const candidate of PORT_CANDIDATES) {
              try {
                server = await tryListen(candidate)
                port = candidate
                break
              } catch {
                continue
              }
            }
            if (!server) throw new Error("Could not find an available port for OCA auth callback")

            const authUrl = buildAuthorizationUrl(config, {
              redirect_uri: redirectUri(port),
              scope: IDCS_SCOPES,
              code_challenge: challenge,
              code_challenge_method: "S256" as const,
            })

            return {
              url: authUrl.href,
              instructions: "Complete Oracle SSO login in your browser",
              method: "auto" as const,
              async callback() {
                try {
                  const result = await new Promise<
                    | {
                        type: "success"
                        refresh: string
                        access: string
                        expires: number
                      }
                    | { type: "failed" }
                  >((resolve, reject) => {
                    const timeout = setTimeout(
                      () => {
                        server!.close()
                        resolve({ type: "failed" })
                      },
                      5 * 60 * 1000,
                    )

                    server!.on("request", async (req, res) => {
                      if (!req.url) return
                      const host = req.headers.host ?? `localhost:${port}`
                      const currentUrl = new URL(req.url, `http://${host}`)
                      if (currentUrl.pathname !== "/callback") return

                      try {
                        const tokens = await authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier: verifier })

                        res.statusCode = 200
                        res.setHeader("Content-Type", "text/plain")
                        res.end("Authentication successful! You can close this window.")

                        clearTimeout(timeout)
                        server!.close()

                        const nowSec = Math.floor(Date.now() / 1000)
                        resolve({
                          type: "success",
                          access: tokens.access_token,
                          refresh: tokens.refresh_token ?? "",
                          expires: typeof tokens.expires_in === "number" ? nowSec + tokens.expires_in : 0,
                        })
                      } catch (err) {
                        res.statusCode = 400
                        res.setHeader("Content-Type", "text/plain")
                        res.end("Authentication failed.")
                        clearTimeout(timeout)
                        server!.close()
                        resolve({ type: "failed" })
                      }
                    })
                  })
                  return result
                } catch {
                  return { type: "failed" as const }
                }
              },
            }
          },
        },
      ],
    },
  }
}
