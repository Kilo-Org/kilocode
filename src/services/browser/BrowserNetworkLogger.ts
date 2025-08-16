import { HTTPResponse, HTTPRequest } from "puppeteer-core"

export interface BrowserNetworkLoggerConfig {
	bodyLimit: number
	maxEntries: number
	// If URL matches any of these, the request/response body will be redacted
	sensitiveUrlPatterns: RegExp[]
	// If request body text matches, redact
	sensitiveBodyPattern: RegExp
	// Mask these headers in both request & response
	maskHeaders: string[]
	bodyRedactionPlaceholder: string
	headerRedactionPlaceholder: string
	// redact sensitive data
	redactOnSensitive: boolean
}

export class BrowserNetworkLogger {
	private cfg: BrowserNetworkLoggerConfig

	constructor(config?: Partial<BrowserNetworkLoggerConfig>) {
		this.cfg = {
			bodyLimit: 500,
			maxEntries: 50,
			sensitiveUrlPatterns: [
				/(login|logout|sign[ -_]?in|sign[ -_]?out|authenticate|session)/i,
				/(oauth|oidc|sso|token|refresh|mfa|2fa|password|reset)/i,
			],
			sensitiveBodyPattern:
				/\b(pass(word)?|pwd|token|refresh_token|access_token|id_token|otp|mfa|assertion|credential|client_secret|code_verifier|grant_type)\b/i,
			maskHeaders: [
				"authorization",
				"proxy-authorization",
				"cookie",
				"set-cookie",
				"x-api-key",
				"x-amz-security-token",
			],
			bodyRedactionPlaceholder: "[redacted]",
			headerRedactionPlaceholder: "[redacted]",
			redactOnSensitive: true,
			...config,
		}
	}

	// -------- public API --------

	/** Maps responses to an array of single-line JSON strings (max 50, errors prioritized, earliest first). */
	public async mapHTTPResponsesToStrings(
		responses: HTTPResponse[],
		maxEntries = this.cfg.maxEntries,
	): Promise<string[]> {
		const limited = this.selectForLimit(responses, maxEntries)

		return Promise.all(
			limited.map(async (res) => {
				const req = res.request()
				const isSensitive = this.isSensitive(req, res)

				// Request headers/body (mask + redact if sensitive)
				const reqHeaders = this.sanitizeHeadersIfDesired(req.headers())
				const reqBodyRaw = req.postData?.() ?? null
				const reqBodyOut =
					isSensitive && this.cfg.redactOnSensitive
						? this.cfg.bodyRedactionPlaceholder
						: this.truncate(reqBodyRaw)

				// Response headers/body (mask + redact if sensitive)
				const respHeaders = this.sanitizeHeadersIfDesired(res.headers())
				const respBodyOut =
					isSensitive && this.cfg.redactOnSensitive
						? this.cfg.bodyRedactionPlaceholder
						: await this.safeResponseText(res)

				const summary = {
					request: {
						method: req.method(),
						url: req.url(),
						headers: reqHeaders,
						body: reqBodyOut,
					},
					response: {
						status: res.status(),
						headers: respHeaders,
						body: respBodyOut,
					},
				}

				return JSON.stringify(summary)
			}),
		)
	}

	// -------- internals --------

	private truncate(input: string | null | undefined): string | null {
		if (input == null) return null
		return input.length > this.cfg.bodyLimit ? input.slice(0, this.cfg.bodyLimit) : input
	}

	private async safeResponseText(res: HTTPResponse): Promise<string> {
		try {
			const t = await res.text()
			return this.truncate(t) ?? ""
		} catch (err: any) {
			const msg = (err?.message ?? String(err)).slice(0, 200)
			return `[body-unavailable: ${msg}]`
		}
	}

	private sanitizeHeadersIfDesired(headers: Record<string, string>): Record<string, string> {
		const masked = { ...headers }
		if (this.cfg.redactOnSensitive) {
			const maskSet = new Set(this.cfg.maskHeaders.map((h) => h.toLowerCase()))
			for (const k of Object.keys(masked)) {
				if (maskSet.has(k.toLowerCase())) {
					masked[k] = this.cfg.headerRedactionPlaceholder
				}
			}
		}
		return masked
	}

	/** Identify sensitive requests by URL patterns, method & headers, and body keywords (without storing original body). */
	private isSensitive(req: HTTPRequest, res: HTTPResponse): boolean {
		const url = req.url()

		// URL-based rules
		const urlSensitive = this.cfg.sensitiveUrlPatterns.some((rx) => rx.test(url))

		// Body-based rules (check text form only, do not parse/retain)
		const bodyRaw = req.postData?.()
		const bodySensitive = !!bodyRaw && this.cfg.sensitiveBodyPattern.test(bodyRaw)

		return urlSensitive || bodySensitive
	}

	/** Prefer earliest responses, prioritize errors (>=400 or 0), hard-cap at maxEntries (<=50). */
	private selectForLimit(responses: HTTPResponse[], maxEntries: number): HTTPResponse[] {
		const max = Math.min(maxEntries, this.cfg.maxEntries)
		const errors: HTTPResponse[] = []
		const nonErrors: HTTPResponse[] = []

		for (const r of responses) {
			const s = r.status()
			if (s >= 400 || s === 0) errors.push(r)
			else nonErrors.push(r)
		}

		const chosenErrors = errors.slice(0, max)
		const remaining = max - chosenErrors.length
		const chosenNonErrors = remaining > 0 ? nonErrors.slice(0, remaining) : []

		const selected = new Set<HTTPResponse>([...chosenErrors, ...chosenNonErrors])
		return responses.filter((r) => selected.has(r)) // preserves original (earliest-first) order
	}
}
