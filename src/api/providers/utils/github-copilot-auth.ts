// kilocode_change - new file
const COPILOT_TOKEN_PRIMARY_URLS = ["https://api.github.com/copilot_internal/v2/token"] as const
const COPILOT_TOKEN_FALLBACK_URLS = [
	"https://api.githubcopilot.com/v2/token",
	"https://api.githubcopilot.com/token",
	"https://api.githubcopilot.com/v1/token",
] as const
const COPILOT_USER_AGENT = process.env.KILOCODE_COPILOT_USER_AGENT ?? "KiloCode/1.0"
const COPILOT_TOKEN_HEADERS = {
	Accept: "application/json",
	"Content-Type": "application/json",
	"Openai-Intent": "conversation-edits",
	"User-Agent": COPILOT_USER_AGENT,
}
const AUTH_SCHEMES = ["token", "Bearer"] as const
const TOKEN_HTTP_METHODS = ["GET", "POST"] as const
const DEBUG_COPILOT_AUTH =
	process.env.KILOCODE_DEBUG_COPILOT_AUTH === "1" || process.env.KILOCODE_DEBUG_COPILOT_AUTH === "true"

export interface CopilotTokenResult {
	token: string
	expiresAt?: number
	refreshAt?: number
}

type CopilotTokenResponse = {
	token?: string
	access_token?: string
	copilot_token?: string
	expires_at?: number | string
	expires_in?: number
	refresh_in?: number
}

const parseEpochMs = (value: number): number => (value > 1e12 ? value : value * 1000)

const getCopilotRequestHeaders = (url: string, githubToken: string, scheme: (typeof AUTH_SCHEMES)[number]) => {
	const isGitHubApi = url.includes("api.github.com")
	return {
		...COPILOT_TOKEN_HEADERS,
		Authorization: `${scheme} ${githubToken}`,
		...(isGitHubApi ? { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } : {}),
	}
}

const extractErrorBody = async (response: Response): Promise<string> => {
	try {
		const text = await response.text()
		if (!text) {
			return ""
		}

		const contentType = response.headers.get("content-type") ?? ""
		if (contentType.includes("application/json")) {
			try {
				const data = JSON.parse(text) as { error?: string; error_description?: string; message?: string }
				const safeParts = [data.error, data.error_description, data.message].filter(Boolean).join(": ")
				return (safeParts || text).slice(0, 200)
			} catch {
				return text.slice(0, 200)
			}
		}

		return text.slice(0, 200)
	} catch {
		return ""
	}
}

const parseExpiresAt = (value?: number | string): number | undefined => {
	if (typeof value === "number") {
		return parseEpochMs(value)
	}
	if (typeof value === "string") {
		const parsed = Date.parse(value)
		return Number.isNaN(parsed) ? undefined : parsed
	}
	return undefined
}

const extractToken = (data: CopilotTokenResponse): string | undefined =>
	data.token ?? data.copilot_token ?? data.access_token

export const resolveGitHubCopilotToken = (configuredToken?: string): string => {
	return configuredToken ?? ""
}

async function requestCopilotToken(
	url: string,
	githubToken: string,
	scheme: (typeof AUTH_SCHEMES)[number],
	method: string,
) {
	return fetch(url, {
		method,
		headers: getCopilotRequestHeaders(url, githubToken, scheme),
	})
}

type CopilotTokenAttempt = {
	result?: CopilotTokenResult
	lastError?: Error
	meaningfulError?: Error
	allNotFound?: boolean
}

async function attemptCopilotTokenExchange(urls: readonly string[], githubToken: string): Promise<CopilotTokenAttempt> {
	let lastError: Error | undefined
	let meaningfulError: Error | undefined
	let sawNotFound = false
	let sawNonNotFound = false

	for (const url of urls) {
		for (const scheme of AUTH_SCHEMES) {
			let response: Response
			try {
				response = await requestCopilotToken(url, githubToken, scheme, TOKEN_HTTP_METHODS[0])

				if (!response.ok && (response.status === 404 || response.status === 405)) {
					response = await requestCopilotToken(url, githubToken, scheme, TOKEN_HTTP_METHODS[1])
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				const requestError = new Error(
					`Failed to exchange GitHub Copilot token (${url}, ${scheme}): ${errorMessage}`,
				)
				lastError = requestError
				meaningfulError ??= requestError
				sawNonNotFound = true
				if (DEBUG_COPILOT_AUTH) {
					console.info(
						`[GitHubCopilotAuth] Token exchange request failed (${url}, ${scheme}): ${errorMessage}`,
					)
				}
				continue
			}

			if (!response.ok) {
				if (response.status === 404 || response.status === 405) {
					sawNotFound = true
				} else {
					sawNonNotFound = true
				}
				if (DEBUG_COPILOT_AUTH) {
					console.info(
						`[GitHubCopilotAuth] Token exchange failed ${response.status} ${response.statusText} (${url}, ${scheme})`,
					)
				}
				const errorBody = await extractErrorBody(response)
				const detail = errorBody ? `: ${errorBody}` : ""
				const error = new Error(
					`Failed to exchange GitHub Copilot token (${url}): ${response.status} ${response.statusText}${detail}`,
				)
				lastError = error

				if (response.status !== 404 && response.status !== 405) {
					meaningfulError ??= error
				}

				// 404/405 likely means endpoint not available for this host.
				if (response.status === 404 || response.status === 405) {
					break
				}

				// Try the next auth scheme if unauthorized with "token".
				if ((response.status === 401 || response.status === 403) && scheme === "token") {
					continue
				}

				// Try next host for other errors.
				continue
			}

			const data = (await response.json()) as CopilotTokenResponse
			const token = extractToken(data)

			if (!token) {
				const error = new Error("GitHub Copilot token response did not include a token.")
				lastError = error
				meaningfulError ??= error
				sawNonNotFound = true
				continue
			}

			const now = Date.now()
			const expiresAt =
				parseExpiresAt(data.expires_at) ?? (data.expires_in ? now + data.expires_in * 1000 : undefined)
			const refreshAt = data.refresh_in ? now + data.refresh_in * 1000 : undefined

			return { result: { token, expiresAt, refreshAt }, lastError, meaningfulError }
		}
	}

	return { lastError, meaningfulError, allNotFound: sawNotFound && !sawNonNotFound }
}

export async function fetchCopilotToken(githubToken: string): Promise<CopilotTokenResult> {
	if (!githubToken) {
		throw new Error("Missing GitHub OAuth token for Copilot exchange.")
	}

	const primaryAttempt = await attemptCopilotTokenExchange(COPILOT_TOKEN_PRIMARY_URLS, githubToken)
	if (primaryAttempt.result) {
		return primaryAttempt.result
	}

	const fallbackAttempt = await attemptCopilotTokenExchange(COPILOT_TOKEN_FALLBACK_URLS, githubToken)
	if (fallbackAttempt.result) {
		return fallbackAttempt.result
	}

	if (primaryAttempt.allNotFound && fallbackAttempt.allNotFound) {
		if (DEBUG_COPILOT_AUTH) {
			console.info("[GitHubCopilotAuth] Token exchange endpoints unavailable; using OAuth token directly.")
		}
		return { token: githubToken }
	}

	throw (
		primaryAttempt.meaningfulError ??
		fallbackAttempt.meaningfulError ??
		primaryAttempt.lastError ??
		fallbackAttempt.lastError ??
		new Error("Failed to exchange GitHub Copilot token.")
	)
}
