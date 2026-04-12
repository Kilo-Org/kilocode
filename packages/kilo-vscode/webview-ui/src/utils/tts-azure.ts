import type { PronunciationEntry } from "../types/voice"

const AUDIO_FORMATS: Record<string, string> = {
	"audio-16khz-32kbitrate-mono-mp3": "audio-16khz-32kbitrate-mono-mp3",
	"audio-24khz-48kbitrate-mono-mp3": "audio-24khz-48kbitrate-mono-mp3",
	"audio-48khz-96kbitrate-mono-mp3": "audio-48khz-96kbitrate-mono-mp3",
}

export interface AzureTTSOptions {
	region: string
	apiKey: string
	voiceId: string
	pitch?: number
	rate?: number
	volume?: number
	style?: string
	styleDegree?: number
	emphasis?: string
	pronunciations?: PronunciationEntry[]
	audioFormat?: string
}

export async function synthesizeAzure(
	text: string,
	opts: AzureTTSOptions,
	signal?: AbortSignal,
): Promise<Blob> {
	if (!opts.region) throw new Error("Azure region is not configured")
	if (!opts.apiKey) throw new Error("Azure API key is not configured")
	if (!opts.voiceId) throw new Error("Azure voice is not selected")

	const ssml = buildSSML(text, opts)
	const format = opts.audioFormat ?? "audio-24khz-48kbitrate-mono-mp3"

	const resp = await fetch(
		`https://${opts.region}.tts.speech.microsoft.com/cognitiveservices/v1`,
		{
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": opts.apiKey,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": format,
				"User-Agent": "KiloCode-Azure",
			},
			body: ssml,
			signal,
		},
	)

	if (!resp.ok) throw new Error(`Azure TTS error ${resp.status}: ${await resp.text()}`)
	const blob = await resp.blob()
	if (blob.size < 100) throw new Error("Azure returned empty audio -- check voice ID and region")
	return blob
}

function buildSSML(text: string, opts: AzureTTSOptions): string {
	let processedText = applyPronunciations(escapeXml(text), opts.pronunciations ?? [])

	// Wrap in emphasis if set
	if (opts.emphasis && opts.emphasis !== "none") {
		processedText = `<emphasis level="${opts.emphasis}">${processedText}</emphasis>`
	}

	// Wrap in prosody if any prosody changes
	const prosodyAttrs: string[] = []
	if (opts.pitch && opts.pitch !== 0) prosodyAttrs.push(`pitch="${opts.pitch > 0 ? "+" : ""}${opts.pitch}%"`)
	if (opts.rate && opts.rate !== 1.0) prosodyAttrs.push(`rate="${opts.rate}"`)
	if (opts.volume != null) prosodyAttrs.push(`volume="${opts.volume}"`)
	if (prosodyAttrs.length > 0) {
		processedText = `<prosody ${prosodyAttrs.join(" ")}>${processedText}</prosody>`
	}

	// Wrap in express-as if style is set
	if (opts.style && opts.style !== "default") {
		const degree = opts.styleDegree ?? 1.0
		processedText = `<mstts:express-as style="${opts.style}" styledegree="${degree}">${processedText}</mstts:express-as>`
	}

	return (
		`<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
		`xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
		`<voice name="${opts.voiceId}">${processedText}</voice></speak>`
	)
}

function applyPronunciations(text: string, pronunciations: PronunciationEntry[]): string {
	let result = text
	for (const p of pronunciations) {
		const escaped = escapeXml(p.word)
		const regex = new RegExp(escapeRegex(escaped), "gi")
		result = result.replace(regex, `<sub alias="${escapeXml(p.pronounceAs)}">${escaped}</sub>`)
	}
	return result
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
