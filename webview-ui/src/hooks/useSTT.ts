// kilocode_change - new file: React hook for STT (Speech-to-Text) functionality
import { useState, useEffect, useCallback, useRef } from "react"
import { vscode } from "../utils/vscode"
import { STTSegment } from "../../../src/shared/sttContract"

export interface UseSTTOptions {
	/** Called when recording completes with final text */
	onComplete?: (text: string) => void
	/** Called on error */
	onError?: (error: string) => void
}

export interface UseSTTReturn {
	/** Whether currently recording */
	isRecording: boolean
	/** Transcript segments (complete state from extension) */
	segments: STTSegment[]
	/** Current volume level 0-1 */
	volume: number
	/** Start recording */
	start: (language?: string) => void
	/** Stop recording and finalize */
	stop: () => void
	/** Cancel recording and discard */
	cancel: () => void
}

/**
 * Hook for Speech-to-Text functionality
 *
 * Usage:
 * ```tsx
 * const { isRecording, transcript, start, stop } = useSTT({
 *   onComplete: (text) => {
 *     setInputValue(prev => prev + " " + text)
 *   }
 * })
 * ```
 */
export function useSTT(options: UseSTTOptions = {}): UseSTTReturn {
	const { onComplete, onError } = options

	// Optimistic state for immediate UI updates
	const [optimisticIsRecording, setOptimisticIsRecording] = useState(false)
	// Real state from backend (used to correct optimistic state if needed)
	const [realIsRecording, setRealIsRecording] = useState(false)
	const [segments, setSegments] = useState<STTSegment[]>([])
	const [volume, setVolume] = useState(0)

	// Track session to ignore stale events
	const sessionIdRef = useRef<string | null>(null)
	// Use ref to avoid stale closure - segments must be current when stt:stopped fires
	const segmentsRef = useRef<STTSegment[]>([])

	useEffect(() => {
		segmentsRef.current = segments
	}, [segments])

	// Sync optimistic state with real state when backend responds
	useEffect(() => {
		setOptimisticIsRecording(realIsRecording)
	}, [realIsRecording])

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data

			// Only handle STT events
			if (!msg.type?.startsWith("stt:")) return

			switch (msg.type) {
				case "stt:started":
					sessionIdRef.current = msg.sessionId
					setRealIsRecording(true)
					setSegments([])
					break

				case "stt:transcript":
					// Ignore events from old sessions
					if (msg.sessionId !== sessionIdRef.current) return
					// Just pass through the segments from extension (stateless)
					console.log("🎙️ [useSTT WebView] 📨 Received segments:", JSON.stringify(msg.segments, null, 2))
					setSegments(msg.segments || [])
					break

				case "stt:volume":
					if (msg.sessionId !== sessionIdRef.current) return
					setVolume(msg.level)
					break

				case "stt:stopped":
					setRealIsRecording(false)
					setOptimisticIsRecording(false) // Immediately sync optimistic state on stop
					setVolume(0)

					if (msg.reason === "completed") {
						// Get final text from most recent segments (via ref to avoid stale closure)
						const finalText = segmentsRef.current
							.map((s) => s.text)
							.join(" ")
							.trim()
						if (finalText) {
							onComplete?.(finalText)
						}
					} else if (msg.reason === "error" && msg.error) {
						onError?.(msg.error)
					}

					// Clear segments
					setSegments([])
					sessionIdRef.current = null
					break
			}
		}

		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [onComplete, onError])

	const start = useCallback((language?: string) => {
		setOptimisticIsRecording(true)
		vscode.postMessage({ type: "stt:start", language })
	}, [])

	const stop = useCallback(() => {
		setOptimisticIsRecording(false)
		vscode.postMessage({ type: "stt:stop" })
	}, [])

	const cancel = useCallback(() => {
		setOptimisticIsRecording(false)
		vscode.postMessage({ type: "stt:cancel" })
	}, [])

	return {
		isRecording: optimisticIsRecording,
		segments,
		volume,
		start,
		stop,
		cancel,
	}
}
