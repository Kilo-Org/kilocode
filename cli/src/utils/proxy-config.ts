/**
 * Proxy configuration for CLI
 * Reads proxy settings from environment variables and configures axios, fetch, and undici
 */

import axios from "axios"
import { HttpProxyAgent } from "http-proxy-agent"
import { HttpsProxyAgent } from "https-proxy-agent"
import { logs } from "../services/logs.js"
import { parseNoProxy, shouldBypassProxy } from "./proxy-matcher.js"

export interface ProxyConfig {
	httpProxy?: string
	httpsProxy?: string
	noProxy: string[]
	rejectUnauthorized: boolean
}

/**
 * Get proxy configuration from environment variables
 */
export function getProxyConfig(): ProxyConfig {
	// Read proxy environment variables (case-insensitive)
	const httpProxy =
		process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || undefined

	const httpsProxy =
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		process.env.ALL_PROXY ||
		process.env.all_proxy ||
		undefined

	const noProxyStr = process.env.NO_PROXY || process.env.no_proxy || ""
	const noProxy = parseNoProxy(noProxyStr)

	// Handle NODE_TLS_REJECT_UNAUTHORIZED for self-signed certificates
	const rejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED !== "0"

	const result: ProxyConfig = {
		noProxy,
		rejectUnauthorized,
	}

	if (httpProxy) {
		result.httpProxy = httpProxy
	}

	if (httpsProxy) {
		result.httpsProxy = httpsProxy
	}

	return result
}

/**
 * Configure axios, fetch, and undici to use proxy settings from environment variables
 * This must be called before any HTTP requests are made
 */
export function configureProxy(): void {
	const config = getProxyConfig()

	// Log proxy configuration (without credentials)
	if (config.httpProxy || config.httpsProxy) {
		logs.info("Configuring proxy settings:", "Proxy")
		if (config.httpProxy) {
			logs.info(`  HTTP_PROXY: ${sanitizeProxyUrl(config.httpProxy)}`, "Proxy")
		}
		if (config.httpsProxy) {
			logs.info(`  HTTPS_PROXY: ${sanitizeProxyUrl(config.httpsProxy)}`, "Proxy")
		}
		if (config.noProxy.length > 0) {
			logs.info(`  NO_PROXY: ${config.noProxy.join(", ")}`, "Proxy")
		}
		if (!config.rejectUnauthorized) {
			logs.warn("  TLS certificate validation: DISABLED (NODE_TLS_REJECT_UNAUTHORIZED=0)", "Proxy")
		}
	}

	// Create proxy agents
	const httpProxyAgent = config.httpProxy ? new HttpProxyAgent(config.httpProxy) : undefined
	const httpsProxyAgent = config.httpsProxy
		? new HttpsProxyAgent(config.httpsProxy, {
				rejectUnauthorized: config.rejectUnauthorized,
			})
		: undefined

	// Configure axios defaults
	axios.defaults.httpAgent = httpProxyAgent
	axios.defaults.httpsAgent = httpsProxyAgent

	// Add request interceptor to handle NO_PROXY for axios
	axios.interceptors.request.use(
		(requestConfig) => {
			const url = requestConfig.url
			if (!url) {
				return requestConfig
			}

			// Check if this URL should bypass the proxy
			if (shouldBypassProxy(url, config.noProxy)) {
				// Remove proxy agents for this request
				requestConfig.httpAgent = undefined
				requestConfig.httpsAgent = undefined
				requestConfig.proxy = false
			}

			return requestConfig
		},
		(error) => {
			return Promise.reject(error)
		},
	)

	// Configure undici for fetch requests
	configureUndiciProxy(config).catch((error) => {
		logs.debug("Failed to configure undici proxy", "Proxy", { error })
	})

	logs.info("Proxy configuration complete (axios, fetch, undici)", "Proxy")
}

/**
 * Sanitize proxy URL for logging (remove credentials)
 */
function sanitizeProxyUrl(proxyUrl: string): string {
	try {
		const url = new URL(proxyUrl)
		if (url.username || url.password) {
			return `${url.protocol}//*****:*****@${url.host}`
		}
		return proxyUrl
	} catch {
		return proxyUrl
	}
}

/**
 * Configure undici proxy (async to handle dynamic import)
 */
async function configureUndiciProxy(config: ProxyConfig): Promise<void> {
	try {
		// Configure undici (used by some providers like fetchWithTimeout)
		const undici = await import("undici")
		if (undici && undici.setGlobalDispatcher) {
			const { ProxyAgent } = undici

			// Use HTTPS proxy for all requests if configured, fallback to HTTP proxy
			const proxyUri = config.httpsProxy || config.httpProxy
			if (proxyUri) {
				const proxyAgent = new ProxyAgent({
					uri: proxyUri,
					requestTls: {
						rejectUnauthorized: config.rejectUnauthorized,
					},
				})
				undici.setGlobalDispatcher(proxyAgent)
				logs.debug("Undici proxy agent configured", "Proxy")
			}
		}
	} catch (error) {
		logs.debug("Undici not available or failed to configure", "Proxy", { error })
	}
}

/**
 * Check if proxy is configured
 */
export function isProxyConfigured(): boolean {
	const config = getProxyConfig()
	return !!(config.httpProxy || config.httpsProxy)
}
