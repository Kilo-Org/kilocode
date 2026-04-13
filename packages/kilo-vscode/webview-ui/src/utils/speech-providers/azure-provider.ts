import type { SpeechProvider, SpeechVoice, SynthesisOptions } from "../../types/voice"
import { AZURE_VOICES } from "../../data/azure-voices"
import { synthesizeAzure } from "../tts-azure"

const controller: { current: AbortController | undefined } = { current: undefined }

function mapVoice(v: (typeof AZURE_VOICES)[number]): SpeechVoice {
	return {
		id: v.id,
		name: v.name,
		locale: v.locale,
		gender: v.gender,
		description: v.description,
		provider: "azure",
		styles: v.styles.length > 0 ? v.styles : undefined,
	}
}

export const AzureProvider: SpeechProvider = {
	id: "azure",
	name: "Azure Cognitive Services",
	tier: "freeTier",
	requiresApiKey: true,
	description: "Microsoft Azure Text-to-Speech with premium neural voices and SSML",
	freeAllowance: "500K chars/month free tier",
	capabilities: {
		ssml: true,
		styles: true,
		emphasis: true,
		pronunciations: true,
		audioFormats: [
			"audio-16khz-32kbitrate-mono-mp3",
			"audio-24khz-48kbitrate-mono-mp3",
			"audio-48khz-96kbitrate-mono-mp3",
		],
	},

	getVoices(): SpeechVoice[] {
		return AZURE_VOICES.map(mapVoice)
	},

	async synthesize(text: string, opts: SynthesisOptions): Promise<Blob> {
		controller.current?.abort()
		const ac = new AbortController()
		controller.current = ac

		return synthesizeAzure(
			text,
			{
				region: opts.region ?? "westus",
				apiKey: opts.apiKey ?? "",
				voiceId: opts.voiceId,
				pitch: opts.pitch,
				rate: opts.rate,
				volume: opts.volume,
				style: opts.style,
				styleDegree: opts.styleDegree,
				emphasis: opts.emphasis,
				pronunciations: opts.pronunciations,
				audioFormat: opts.audioFormat,
			},
			ac.signal,
		)
	},

	stop(): void {
		controller.current?.abort()
		controller.current = undefined
	},

	async testConnection(apiKey: string, region?: string): Promise<boolean> {
		try {
			const endpoint = region ?? "westus"
			const ssml =
				`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
				`<voice name="en-US-JennyNeural">test</voice></speak>`

			const resp = await fetch(
				`https://${endpoint}.tts.speech.microsoft.com/cognitiveservices/v1`,
				{
					method: "POST",
					headers: {
						"Ocp-Apim-Subscription-Key": apiKey,
						"Content-Type": "application/ssml+xml",
						"X-Microsoft-OutputFormat": "audio-16khz-32kbitrate-mono-mp3",
						"User-Agent": "KiloCode-Azure",
					},
					body: ssml,
				},
			)
			return resp.ok
		} catch {
			return false
		}
	},
}
