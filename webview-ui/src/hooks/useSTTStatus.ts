// kilocode_change - new file: Custom hook to manage STT status and error state
import { useState, useCallback } from "react"

export type SpeechToTextStatus =
	| {
			available: boolean
			reason?: "openaiKeyMissing" | "ffmpegNotInstalled"
	  }
	| undefined

export interface UseSTTStatusReturn {
	status: SpeechToTextStatus
	error: string | null
	setError: (error: string | null) => void
	handleStatusChange: (newStatus: SpeechToTextStatus) => void
}

/**
 * Hook to manage STT status and error state
 * Automatically clears error when status becomes available
 */
export function useSTTStatus(): UseSTTStatusReturn {
	const [status, setStatus] = useState<SpeechToTextStatus>(undefined)
	const [error, setError] = useState<string | null>(null)

	const handleStatusChange = useCallback((newStatus: SpeechToTextStatus) => {
		setStatus(newStatus)
		// Clear error when STT becomes available (e.g., user fixed their API key)
		if (newStatus?.available) {
			setError(null)
		}
	}, [])

	return {
		status,
		error,
		setError,
		handleStatusChange,
	}
}
