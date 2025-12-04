export const generateMessage = () => {
	const now = Date.now()
	const uniqueSuffix = Math.floor(Math.random() * 10000)
	return {
		id: `msg-${now}-${uniqueSuffix}`,
		ts: now,
	}
}

/**
 * Generate user-friendly message for model fallback
 * @param params - Message parameters
 * @returns Formatted message for display
 */
export const generateModelFallbackMessage = (params: {
	previousModel: string
	newModel: string
	organizationName?: string
}) => {
	const { previousModel, newModel, organizationName } = params
	const orgContext = organizationName || "this organization"
	const content = `Model "${previousModel}" is not available for ${orgContext}. Automatically switched to "${newModel}".`
	return {
		...generateMessage(),
		type: "system" as const,
		content,
	}
}

/**
 * Generate user-friendly message for mode fallback
 * @param params - Message parameters
 * @returns Formatted message for display
 */
export const generateModeFallbackMessage = (params: {
	previousMode: string
	newMode: string
	organizationName?: string
}) => {
	const { previousMode, newMode, organizationName } = params
	const orgContext = organizationName || "this organization"
	const content = `Mode "${previousMode}" is not available for ${orgContext}. Automatically switched to "${newMode}" mode.`
	return {
		...generateMessage(),
		type: "system" as const,
		content,
	}
}
