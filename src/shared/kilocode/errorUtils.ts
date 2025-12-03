export function stringifyError(error: unknown) {
	return error instanceof Error ? error.stack || error.message : String(error)
}

function getErrorMessage(error: any): string | undefined {
	if (!error) {
		return undefined
	}

	if (typeof error.error === "string") {
		return error.error
	}

	if (typeof error.error?.message === "string") {
		return error.error.message
	}

	if (typeof error.message === "string") {
		return error.message
	}

	return undefined
}

function isInsufficientCreditsThrottle(error: any) {
	if (!error || error.status !== 429) {
		return false
	}

	const message = getErrorMessage(error)
	return typeof message === "string" && message.toLowerCase().includes("insufficient credit")
}

export function isPaymentRequiredError(error: any) {
	return !!(error && error.status === 402) || isInsufficientCreditsThrottle(error)
}

export function isAlphaPeriodEndedError(error: any) {
	return !!(
		error &&
		error.status === 404 &&
		(error.message?.indexOf("alpha period") ?? -1) >= 0 &&
		(error.message?.indexOf("has ended") ?? -1) >= 0
	)
}

function isOpenRouterInvalidModelError(error: any) {
	return !!(error && error.status === 400 && (error.message?.indexOf("not a valid model") ?? -1) >= 0)
}

export function isModelNotAllowedForTeamError(error: any) {
	//https://github.com/MatterAIOrg/AxonCode-backend/blob/66489e1b0f6f996338acf8bcc1b3558252e20e9d/src/app/api/openrouter/%5B...path%5D/route.ts#L371
	return !!(error && error.status === 404 && (error.message?.indexOf("not allowed for your team") ?? -1) >= 0)
}

export function isAnyRecognizedKiloCodeError(error: any) {
	return (
		isPaymentRequiredError(error) ||
		isOpenRouterInvalidModelError(error) ||
		isAlphaPeriodEndedError(error) ||
		isModelNotAllowedForTeamError(error)
	)
}
