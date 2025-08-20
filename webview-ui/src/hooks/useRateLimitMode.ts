import { useState, useEffect, useCallback } from "react"
import { ProviderSettings } from "@roo-code/types"

/**
 * Custom hook to manage rate limit mode selection between "seconds" and "requests"
 * This encapsulates the complex state synchronization logic
 */
export function useRateLimitMode(
	apiConfiguration: ProviderSettings,
	setApiConfigurationField: <K extends keyof ProviderSettings>(field: K, value: ProviderSettings[K]) => void,
) {
	// Determine initial mode based on which value is set
	const [rateLimitMode, setRateLimitMode] = useState<"seconds" | "requests">(() => {
		if (apiConfiguration?.requestsPerMinute !== undefined && apiConfiguration.requestsPerMinute > 0) {
			return "requests"
		}
		return "seconds"
	})

	// Sync rate limit mode with apiConfiguration changes
	useEffect(() => {
		if (apiConfiguration?.requestsPerMinute !== undefined && apiConfiguration.requestsPerMinute > 0) {
			setRateLimitMode("requests")
		} else if (apiConfiguration?.rateLimitSeconds !== undefined) {
			setRateLimitMode("seconds")
		}
	}, [apiConfiguration?.requestsPerMinute, apiConfiguration?.rateLimitSeconds])

	// Handler for mode change with automatic value management
	const handleModeChange = useCallback(
		(value: "seconds" | "requests") => {
			setRateLimitMode(value)
			if (value === "seconds") {
				// Clear requests per minute and ensure seconds has a value
				setApiConfigurationField("requestsPerMinute", undefined)
				const currentSeconds = apiConfiguration.rateLimitSeconds
				setApiConfigurationField("rateLimitSeconds", currentSeconds !== undefined && currentSeconds >= 0 ? currentSeconds : 0)
			} else {
				// Clear seconds and ensure requests per minute has a value
				setApiConfigurationField("rateLimitSeconds", undefined)
				const currentRequests = apiConfiguration.requestsPerMinute
				setApiConfigurationField("requestsPerMinute", currentRequests !== undefined && currentRequests > 0 ? currentRequests : 10)
			}
		},
		[apiConfiguration.rateLimitSeconds, apiConfiguration.requestsPerMinute, setApiConfigurationField],
	)

	// Handler for rate limit seconds change
	const handleSecondsChange = useCallback(
		(value: number) => {
			setApiConfigurationField("rateLimitSeconds", value)
			// Ensure requestsPerMinute is cleared when using seconds mode
			if (apiConfiguration.requestsPerMinute !== undefined) {
				setApiConfigurationField("requestsPerMinute", undefined)
			}
		},
		[apiConfiguration.requestsPerMinute, setApiConfigurationField],
	)

	// Handler for requests per minute change
	const handleRequestsChange = useCallback(
		(value: number) => {
			setApiConfigurationField("requestsPerMinute", value)
			// Ensure rateLimitSeconds is cleared when using requests mode
			if (apiConfiguration.rateLimitSeconds !== undefined) {
				setApiConfigurationField("rateLimitSeconds", undefined)
			}
		},
		[apiConfiguration.rateLimitSeconds, setApiConfigurationField],
	)

	return {
		rateLimitMode,
		handleModeChange,
		handleSecondsChange,
		handleRequestsChange,
	}
}