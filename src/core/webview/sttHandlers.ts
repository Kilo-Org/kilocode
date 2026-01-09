// kilocode_change - new file: STT message handlers (replaces speechMessageHandlers.ts)
import type { ClineProvider } from "./ClineProvider"
import type { STTCommand, STTSegment, MicrophoneDevice } from "../../shared/sttContract"
import { STTService } from "../../services/stt"
import { STTEventEmitter } from "../../services/stt/types"
import { getOpenAiApiKey } from "../../services/stt/utils/getOpenAiCredentials"
import { VisibleCodeTracker } from "../../services/ghost/context/VisibleCodeTracker"
import { extractCodeGlossary, formatGlossaryAsPrompt } from "../../services/stt/context/codeGlossaryExtractor"
import { listMicrophoneDevices } from "../../services/stt/FFmpegDeviceEnumerator"
import { checkSpeechToTextAvailable } from "./speechToTextCheck"

/**
 * Map of ClineProvider -> STTService
 * WeakMap ensures cleanup when ClineProvider is garbage collected
 */
const servicesByProviderRef = new WeakMap<ClineProvider, STTService>()

/**
 * Get or create STTService for a provider
 */
function getService(clineProvider: ClineProvider): STTService {
	let service = servicesByProviderRef.get(clineProvider)

	if (!service) {
		const emitter: STTEventEmitter = {
			onStarted: (sessionId: string) => {
				clineProvider.postMessageToWebview({
					type: "stt:started",
					sessionId,
				})
			},

			onTranscript: (segments: STTSegment[], isFinal: boolean) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:transcript",
					sessionId,
					segments,
					isFinal,
				})
			},

			onVolume: (level: number) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:volume",
					sessionId,
					level,
				})
			},

			onStopped: (reason, text, error) => {
				const sessionId = service?.getSessionId() || ""
				clineProvider.postMessageToWebview({
					type: "stt:stopped",
					sessionId,
					reason,
					text,
					error,
				})
			},
		}

		// Create code glossary with snapshotted rooIgnoreController
		const currentTask = clineProvider.getCurrentTask()
		const codeGlossary = new VisibleCodeGlossary(clineProvider.cwd, currentTask?.rooIgnoreController ?? null)

		const globalSettings = clineProvider.contextProxy.getValues()
		const selectedDevice = globalSettings.selectedMicrophoneDevice
		const deviceId = selectedDevice?.id

		service = new STTService(emitter, clineProvider.providerSettingsManager, codeGlossary, deviceId)
		servicesByProviderRef.set(clineProvider, service)
	}

	return service
}

/**
 * Handle stt:start command
 */
export async function handleSTTStart(clineProvider: ClineProvider, language?: string): Promise<void> {
	const service = getService(clineProvider)

	const apiKey = await getOpenAiApiKey(clineProvider.providerSettingsManager)
	if (!apiKey) {
		clineProvider.postMessageToWebview({
			type: "stt:stopped",
			sessionId: "",
			reason: "error",
			error: "OpenAI API key not configured. Please add an OpenAI provider in settings.",
		})
		return
	}

	try {
		// Service generates its own prompt from the code glossary
		await service.start({ apiKey }, language)
	} catch (error) {
		console.error("🎙️ [sttHandlers] ❌ Failed to start STT service:", error)

		// The service.start() catch block should have already called onStopped,
		// but as a defensive measure, ensure frontend is notified if sessionId is still available
		const sessionId = service.getSessionId()
		if (sessionId) {
			const errorMessage = error instanceof Error ? error.message : "Failed to start STT service"
			clineProvider.postMessageToWebview({
				type: "stt:stopped",
				sessionId,
				reason: "error",
				error: errorMessage,
			})
		}
	}
}

/**
 * Handle stt:stop command
 */
export async function handleSTTStop(clineProvider: ClineProvider): Promise<void> {
	const service = getService(clineProvider)
	await service.stop()
}

/**
 * Handle stt:cancel command
 */
export async function handleSTTCancel(clineProvider: ClineProvider): Promise<void> {
	const service = getService(clineProvider)
	service.cancel()
}

/**
 * Handle stt:listDevices command
 */
export async function handleSTTListDevices(clineProvider: ClineProvider): Promise<void> {
	try {
		const devices = await listMicrophoneDevices()
		clineProvider.postMessageToWebview({ type: "stt:devices", devices })
	} catch (error) {
		console.error("🎙️ [sttHandlers] ❌ Failed to list devices:", error)
		clineProvider.postMessageToWebview({ type: "stt:devices", devices: [] })
	}
}

/**
 * Handle stt:selectDevice command
 */
export async function handleSTTSelectDevice(
	clineProvider: ClineProvider,
	device: MicrophoneDevice | null,
): Promise<void> {
	try {
		await clineProvider.contextProxy.setValue("selectedMicrophoneDevice", device)
		const service = servicesByProviderRef.get(clineProvider)
		await service?.setMicrophoneDevice(device)

		clineProvider.postMessageToWebview({ type: "stt:deviceSelected", device })
		await clineProvider.postStateToWebview()
	} catch (error) {
		console.error("🎙️ [sttHandlers] ❌ Failed to select device:", error)
		clineProvider.postMessageToWebview({ type: "stt:deviceSelected", device: null })
	}
}

/**
 * Handle stt:checkAvailability command
 */
export async function handleSTTCheckAvailability(clineProvider: ClineProvider): Promise<void> {
	clineProvider.postMessageToWebview({
		type: "stt:statusResponse",
		speechToTextStatus: await checkSpeechToTextAvailable(clineProvider.providerSettingsManager),
	})
}

/**
 * Unified handler for all STT commands
 */
export async function handleSTTCommand(clineProvider: ClineProvider, command: STTCommand): Promise<void> {
	switch (command.type) {
		case "stt:start":
			await handleSTTStart(clineProvider, command.language)
			break
		case "stt:stop":
			await handleSTTStop(clineProvider)
			break
		case "stt:cancel":
			await handleSTTCancel(clineProvider)
			break
		case "stt:listDevices":
			await handleSTTListDevices(clineProvider)
			break
		case "stt:selectDevice":
			await handleSTTSelectDevice(clineProvider, command.device)
			break
		case "stt:checkAvailability":
			await handleSTTCheckAvailability(clineProvider)
			break
	}
}

/**
 * VisibleCodeGlossary captures visible code and formats it
 * Snapshots the VisibleCodeTracker at construction for reuse during recording session
 */
class VisibleCodeGlossary {
	private tracker: VisibleCodeTracker

	constructor(cwd: string, rooIgnoreController: any) {
		this.tracker = new VisibleCodeTracker(cwd, rooIgnoreController)
	}

	async getGlossary(): Promise<string> {
		try {
			const visibleCode = await this.tracker.captureVisibleCode()
			const glossary = extractCodeGlossary(visibleCode)
			return formatGlossaryAsPrompt(glossary) || ""
		} catch (error) {
			// Non-critical failure - return empty string
			return ""
		}
	}
}
