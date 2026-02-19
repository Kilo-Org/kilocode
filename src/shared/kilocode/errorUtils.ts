export const errorCodes = {
	PAID_MODEL_AUTH_REQUIRED: "PAID_MODEL_AUTH_REQUIRED",
	PROMOTION_MODEL_LIMIT_REACHED: "PROMOTION_MODEL_LIMIT_REACHED",
} as const

export function stringifyError(error: unknown) {
	return error instanceof Error ? error.stack || error.message : String(error)
}

/**
 * Error message thrown when the KiloCode token is missing or invalid.
 */
export const KILOCODE_TOKEN_REQUIRED_ERROR = "KiloCode token + baseUrl is required to fetch models"

export function isPaymentRequiredError(error: any) {
	return !!(error && error.status === 402)
}

export function isUnauthorizedGenericError(error: any) {
	// Catch-all for non-defined 401 errors
	return !!(
		error &&
		error.status === 401 &&
		!isUnauthorizedPaidModelError(error) &&
		!isUnauthorizedPromotionLimitError(error)
	)
}

export function isUnauthorizedPaidModelError(error: any) {
	return !!(error && error.status === 401 && error.code === errorCodes.PAID_MODEL_AUTH_REQUIRED)
}

export function isUnauthorizedPromotionLimitError(error: any) {
	// Accepts both 401 (current backend) and 429 (future backend) to support
	// the transition. Keep 401 until the backend is updated to return 429.
	return !!(
		error &&
		(error.status === 401 || error.status === 429) &&
		error.code === errorCodes.PROMOTION_MODEL_LIMIT_REACHED
	)
}

export function isAlphaPeriodEndedError(error: any) {
	return !!(
		error &&
		error.status === 404 &&
		((error.message?.indexOf("was a stealth model") ?? -1) >= 0 ||
			((error.message?.indexOf("alpha period") ?? -1) >= 0 && (error.message?.indexOf("has ended") ?? -1) >= 0))
	)
}

function isOpenRouterInvalidModelError(error: any) {
	return !!(error && error.status === 400 && (error.message?.indexOf("not a valid model") ?? -1) >= 0)
}

export function isModelNotAllowedForTeamError(error: any) {
	//https://github.com/Kilo-Org/kilocode-backend/blob/66489e1b0f6f996338acf8bcc1b3558252e20e9d/src/app/api/openrouter/%5B...path%5D/route.ts#L371
	return !!(error && error.status === 404 && (error.message?.indexOf("not allowed for your team") ?? -1) >= 0)
}

export function isAnyRecognizedKiloCodeError(error: any) {
	return (
		isPaymentRequiredError(error) ||
		isUnauthorizedGenericError(error) ||
		isUnauthorizedPaidModelError(error) ||
		isUnauthorizedPromotionLimitError(error) ||
		isOpenRouterInvalidModelError(error) ||
		isAlphaPeriodEndedError(error) ||
		isModelNotAllowedForTeamError(error)
	)
}
