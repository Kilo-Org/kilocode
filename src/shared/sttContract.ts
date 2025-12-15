// kilocode_change - new file: STT contract types shared between extension and webview
// Speech-to-Text (STT) event protocol

/**
 * Commands: WebView → Extension
 */
export interface STTStartCommand {
	type: "stt:start"
	language?: string // ISO 639-1 (e.g., "en", "es", "zh")
}

export interface STTStopCommand {
	type: "stt:stop"
}

export interface STTCancelCommand {
	type: "stt:cancel"
}

export type STTCommand = STTStartCommand | STTStopCommand | STTCancelCommand

/**
 * Events: Extension → WebView
 */
export interface STTStartedEvent {
	type: "stt:started"
	sessionId: string
}

/**
 * A segment of transcribed text
 */
export interface STTSegment {
	text: string // The transcribed text
	isPreview: boolean // true = streaming/tentative, false = completed/polished
}

export interface STTTranscriptEvent {
	type: "stt:transcript"
	sessionId: string
	segments: STTSegment[] // Ordered list of all text segments
	isFinal: boolean // false = still updating, true = utterance complete
}

export interface STTVolumeEvent {
	type: "stt:volume"
	sessionId: string
	level: number // 0.0 to 1.0
}

export interface STTStoppedEvent {
	type: "stt:stopped"
	sessionId: string
	reason: "completed" | "cancelled" | "error"
	text?: string // Final transcript (when reason === "completed")
	error?: string // Error message (when reason === "error")
}

export type STTEvent = STTStartedEvent | STTTranscriptEvent | STTVolumeEvent | STTStoppedEvent

/**
 * Type guard for routing in message handlers
 */
export function isSTTCommand(msg: { type: string }): msg is STTCommand {
	return msg.type === "stt:start" || msg.type === "stt:stop" || msg.type === "stt:cancel"
}
