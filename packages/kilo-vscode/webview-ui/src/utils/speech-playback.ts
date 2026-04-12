import { synthesizeAzure, type AzureTTSOptions } from "./tts-azure"

// --- Web Audio API state ---
let _playbackContext: AudioContext | null = null
let _activeSourceNode: AudioBufferSourceNode | null = null
let _activeGainNode: GainNode | null = null
let _abortController: AbortController | null = null

export function ensureAudioReady(): void {
	if (!_playbackContext) _playbackContext = new AudioContext()
	if (_playbackContext.state === "suspended") _playbackContext.resume()
}

export function getPlaybackContext(): AudioContext {
	if (!_playbackContext) _playbackContext = new AudioContext()
	return _playbackContext
}

export async function speak(text: string, opts: AzureTTSOptions & { globalVolume: number }): Promise<void> {
	stop()
	ensureAudioReady()

	_abortController = new AbortController()
	const cacheKey = SynthesisCache.hash(text, opts.voiceId, opts.style ?? "default", opts.pitch ?? 0, opts.rate ?? 1.0)
	let blob = SynthesisCache.get(cacheKey)

	if (!blob) {
		blob = await synthesizeAzure(text, opts, _abortController.signal)
		SynthesisCache.set(cacheKey, blob)
	}

	const volume = opts.volume ?? opts.globalVolume
	await playBlobInternal(blob, volume / 100)
}

export async function playBlobInternal(blob: Blob, volume: number): Promise<void> {
	const ctx = getPlaybackContext()
	const arrayBuffer = await blob.arrayBuffer()
	const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

	const source = ctx.createBufferSource()
	const gain = ctx.createGain()
	gain.gain.value = Math.max(0, Math.min(1, volume))
	source.buffer = audioBuffer
	source.connect(gain).connect(ctx.destination)

	_activeSourceNode = source
	_activeGainNode = gain

	return new Promise<void>((resolve) => {
		source.onended = () => {
			_activeSourceNode = null
			_activeGainNode = null
			resolve()
		}
		source.start(0)
	})
}

export function stop(): void {
	_abortController?.abort()
	_abortController = null
	try {
		_activeSourceNode?.stop()
	} catch {}
	_activeSourceNode = null
	_activeGainNode = null
}

export function setVolume(volume: number): void {
	if (_activeGainNode) {
		_activeGainNode.gain.value = Math.max(0, Math.min(1, volume / 100))
	}
}

// --- LRU Synthesis Cache ---
const CACHE_MAX = 32

class _SynthesisCache {
	private _map = new Map<string, Blob>()

	hash(...parts: (string | number)[]): string {
		return parts.join("|")
	}

	get(key: string): Blob | undefined {
		const blob = this._map.get(key)
		if (blob) {
			this._map.delete(key)
			this._map.set(key, blob)
		}
		return blob
	}

	set(key: string, blob: Blob): void {
		if (this._map.has(key)) this._map.delete(key)
		this._map.set(key, blob)
		while (this._map.size > CACHE_MAX) {
			const oldest = this._map.keys().next().value
			if (oldest) this._map.delete(oldest)
		}
	}

	clear(): void {
		this._map.clear()
	}
}

export const SynthesisCache = new _SynthesisCache()

// --- Session character counter ---
let _sessionChars = 0
export function trackChars(count: number): void {
	_sessionChars += count
}
export function getSessionChars(): number {
	return _sessionChars
}
