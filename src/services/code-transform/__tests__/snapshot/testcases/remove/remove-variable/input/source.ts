/**
 * Configuration constants for the application
 */

// API endpoints
export const API_BASE_URL = "https://api.example.com"
export const AUTH_ENDPOINT = "/auth"
export const USERS_ENDPOINT = "/users"
export const PRODUCTS_ENDPOINT = "/products"

// Timeout values (in milliseconds)
export const DEFAULT_TIMEOUT = 5000
export const LONG_TIMEOUT = 15000

// Deprecated constants - to be removed
export const OLD_API_URL = "https://legacy-api.example.com"
export const LEGACY_TIMEOUT = 3000

// Feature flags
export const ENABLE_DARK_MODE = true
export const ENABLE_NOTIFICATIONS = true
export const ENABLE_ANALYTICS = false

// Export configuration object
export const CONFIG = {
	api: {
		baseUrl: API_BASE_URL,
		endpoints: {
			auth: AUTH_ENDPOINT,
			users: USERS_ENDPOINT,
			products: PRODUCTS_ENDPOINT,
		},
	},
	timeouts: {
		default: DEFAULT_TIMEOUT,
		long: LONG_TIMEOUT,
		legacy: LEGACY_TIMEOUT,
	},
	features: {
		darkMode: ENABLE_DARK_MODE,
		notifications: ENABLE_NOTIFICATIONS,
		analytics: ENABLE_ANALYTICS,
	},
	legacy: {
		apiUrl: OLD_API_URL,
	},
}

// Default export
export default CONFIG
