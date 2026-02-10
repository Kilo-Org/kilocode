/**
 * Type declarations for global-agent package.
 *
 * global-agent is a library that creates a global HTTP/HTTPS agent
 * that routes all traffic through a specified proxy.
 *
 * @see https://github.com/gajus/global-agent
 */

declare module "global-agent" {
	/**
	 * Bootstrap global-agent to intercept all HTTP/HTTPS requests.
	 *
	 * After calling this function, all outgoing HTTP/HTTPS requests
	 * from the Node.js process will be routed through the proxy
	 * specified by the GLOBAL_AGENT_HTTP_PROXY and GLOBAL_AGENT_HTTPS_PROXY
	 * environment variables.
	 *
	 * @returns void
	 */
	export function bootstrap(): void

	/**
	 * Create a global agent with custom configuration.
	 *
	 * @param options Configuration options for the global agent
	 * @returns void
	 */
	export function createGlobalProxyAgent(options?: {
		/**
		 * Environment variable namespace prefix.
		 * Default: "GLOBAL_AGENT_"
		 */
		environmentVariableNamespace?: string

		/**
		 * Force global agent to be used for all HTTP/HTTPS requests.
		 * Default: true
		 */
		forceGlobalAgent?: boolean

		/**
		 * Socket connection timeout in milliseconds.
		 */
		socketConnectionTimeout?: number
	}): void
}
