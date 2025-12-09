export const OCA_MSG = {
	SHOW_AUTH_URL: "oca/show-auth-url",
	LOGIN_SUCCESS: "oca/login-success",
	LOGIN_ERROR: "oca/login-error",
	LOGOUT_SUCCESS: "oca/logout-success",
	STATUS: "oca/status",
} as const

export type OcaShowAuthUrl = { type: typeof OCA_MSG.SHOW_AUTH_URL; url: string }
export type OcaLoginSuccess = { type: typeof OCA_MSG.LOGIN_SUCCESS }
export type OcaLoginError = { type: typeof OCA_MSG.LOGIN_ERROR; error?: string }
export type OcaLogoutSuccess = { type: typeof OCA_MSG.LOGOUT_SUCCESS }
export type OcaStatus = { type: typeof OCA_MSG.STATUS; authenticated?: boolean }

export type OcaWebviewMessage = OcaShowAuthUrl | OcaLoginSuccess | OcaLoginError | OcaLogoutSuccess | OcaStatus

export function isOcaMessage(val: unknown): val is OcaWebviewMessage {
	if (!val || typeof val !== "object") return false
	const t = (val as any).type
	switch (t) {
		case OCA_MSG.SHOW_AUTH_URL:
			return typeof (val as any).url === "string"
		case OCA_MSG.LOGIN_SUCCESS:
			return true
		case OCA_MSG.LOGIN_ERROR:
			return typeof (val as any).error === "string" || typeof (val as any).error === "undefined"
		case OCA_MSG.LOGOUT_SUCCESS:
			return true
		case OCA_MSG.STATUS:
			return typeof (val as any).authenticated === "boolean" || typeof (val as any).authenticated === "undefined"
		default:
			return false
	}
}
