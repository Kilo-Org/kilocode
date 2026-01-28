import http from "http"
import { randomBytes } from "crypto"
import net from "net"
import { exec } from "child_process"

import { AUTH_BASE_URL } from "@/types/index.js"
import { saveToken } from "@/lib/storage/index.js"

export interface LoginOptions {
	timeout?: number
	verbose?: boolean
}

export interface LoginResult {
	success: boolean
	error?: string
	userId?: string
	orgId?: string | null
}

const LOCALHOST = "127.0.0.1"

export async function login({ timeout = 5 * 60 * 1000, verbose = false }: LoginOptions = {}): Promise<LoginResult> {
	const state = randomBytes(16).toString("hex")
	const port = await getAvailablePort()
	const host = `http://${LOCALHOST}:${port}`

	if (verbose) {
		console.log(`[Auth] Starting local callback server on port ${port}`)
	}

	// Create promise that will be resolved when we receive the callback.
	const tokenPromise = new Promise<{ token: string; state: string }>((resolve, reject) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url!, host)

			if (url.pathname === "/callback") {
				const receivedState = url.searchParams.get("state")
				const token = url.searchParams.get("token")
				const error = url.searchParams.get("error")

				if (error) {
					const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=error-in-callback`)
					errorUrl.searchParams.set("message", error)
					res.writeHead(302, { Location: errorUrl.toString() })
					res.end()
					// Wait for response to be fully sent before closing server and rejecting.
					// The 'close' event fires when the underlying connection is terminated,
					// ensuring the browser has received the redirect before we shut down.
					res.on("close", () => {
						server.close()
						reject(new Error(error))
					})
				} else if (!token) {
					const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=missing-token`)
					errorUrl.searchParams.set("message", "Missing token in callback")
					res.writeHead(302, { Location: errorUrl.toString() })
					res.end()
					res.on("close", () => {
						server.close()
						reject(new Error("Missing token in callback"))
					})
				} else if (receivedState !== state) {
					const errorUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in?error=invalid-state-parameter`)
					errorUrl.searchParams.set("message", "Invalid state parameter (possible CSRF attack)")
					res.writeHead(302, { Location: errorUrl.toString() })
					res.end()
					res.on("close", () => {
						server.close()
						reject(new Error("Invalid state parameter"))
					})
				} else {
					res.writeHead(302, { Location: `${AUTH_BASE_URL}/cli/sign-in?success=true` })
					res.end()
					res.on("close", () => {
						server.close()
						resolve({ token, state: receivedState })
					})
				}
			} else {
				res.writeHead(404, { "Content-Type": "text/plain" })
				res.end("Not found")
			}
		})

		server.listen(port, LOCALHOST)

		const timeoutId = setTimeout(() => {
			server.close()
			reject(new Error("Authentication timed out"))
		}, timeout)

		server.on("listening", () => {
			console.log(`[Auth] Callback server listening on port ${port}`)
		})

		server.on("close", () => {
			console.log("[Auth] Callback server closed")
			clearTimeout(timeoutId)
		})
	})

	const authUrl = new URL(`${AUTH_BASE_URL}/cli/sign-in`)
	authUrl.searchParams.set("state", state)
	authUrl.searchParams.set("callback", `${host}/callback`)

	console.log("Opening browser for authentication...")
	console.log(`If the browser doesn't open, visit: ${authUrl.toString()}`)

	try {
		await openBrowser(authUrl.toString())
	} catch (error) {
		if (verbose) {
			console.warn("[Auth] Failed to open browser automatically:", error)
		}

		console.log("Please open the URL above in your browser manually.")
	}

	try {
		const { token } = await tokenPromise
		await saveToken(token)
		console.log("✓ Successfully authenticated!")
		return { success: true }
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		console.error(`✗ Authentication failed: ${message}`)
		return { success: false, error: message }
	}
}

async function getAvailablePort(startPort = 49152, endPort = 65535): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer()
		let port = startPort

		const tryPort = () => {
			server.once("error", (err: NodeJS.ErrnoException) => {
				if (err.code === "EADDRINUSE" && port < endPort) {
					port++
					tryPort()
				} else {
					reject(err)
				}
			})

			server.once("listening", () => {
				server.close(() => {
					resolve(port)
				})
			})

			server.listen(port, LOCALHOST)
		}

		tryPort()
	})
}

function openBrowser(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const platform = process.platform
		let command: string

		switch (platform) {
			case "darwin":
				command = `open "${url}"`
				break
			case "win32":
				command = `start "" "${url}"`
				break
			default:
				// Linux and other Unix-like systems.
				command = `xdg-open "${url}"`
				break
		}

		exec(command, (error) => {
			if (error) {
				reject(error)
			} else {
				resolve()
			}
		})
	})
}
