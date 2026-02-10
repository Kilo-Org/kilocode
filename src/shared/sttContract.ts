// kilocode_change - new file: STT contract types shared between extension and webview
// Speech-to-Text (STT) event protocol

/**
 * Microphone device information
 */
export interface MicrophoneDevice {
	id: string // FFmpeg device identifier (e.g., "0" or "audio=Microphone")
	name: string // Human-readable name (e.g., "Built-in Microphone")
	platform: string // Platform where discovered (e.g., "darwin", "linux", "win32")
}

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

export interface STTListDevicesCommand {
	type: "stt:listDevices"
}

export interface STTSelectDeviceCommand {
	type: "stt:selectDevice"
	device: MicrophoneDevice | null // null means use system default
}

export interface STTCheckAvailabilityCommand {
	type: "stt:checkAvailability"
}

export type STTCommand =
	| STTStartCommand
	| STTStopCommand
	| STTCancelCommand
	| STTListDevicesCommand
	| STTSelectDeviceCommand
	| STTCheckAvailabilityCommand

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

export interface STTDevicesEvent {
	type: "stt:devices"
	devices: MicrophoneDevice[]
}

export interface STTDeviceSelectedEvent {
	type: "stt:deviceSelected"
	device: MicrophoneDevice | null
}

export interface STTStatusResponseEvent {
	type: "stt:statusResponse"
	speechToTextStatus: {
		available: boolean
		reason?: "openaiKeyMissing" | "ffmpegNotInstalled"
	}
}

export type STTEvent =
	| STTStartedEvent
	| STTTranscriptEvent
	| STTVolumeEvent
	| STTStoppedEvent
	| STTDevicesEvent
	| STTDeviceSelectedEvent
	| STTStatusResponseEvent

/**
 * Type guard for routing in message handlers
 */
export function isSTTCommand(msg: { type: string }): msg is STTCommand {
	return msg.type.startsWith("stt:")
}
