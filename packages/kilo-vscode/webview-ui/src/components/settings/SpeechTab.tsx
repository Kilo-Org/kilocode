import { Component, createSignal, createMemo, onCleanup, For, Show } from "solid-js"
import { Switch } from "@kilocode/kilo-ui/switch"
import { Select } from "@kilocode/kilo-ui/select"
import { Card } from "@kilocode/kilo-ui/card"
import { Button } from "@kilocode/kilo-ui/button"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"
import type { SpeechSettings, VoicePreset, PronunciationEntry } from "../../types/voice"
import { DEFAULT_SPEECH_SETTINGS } from "../../types/voice"
import { AZURE_VOICES, AZURE_LOCALES, LOCALE_NAMES, DEFAULT_VOICE_ID, type AzureVoice } from "../../data/azure-voices"
import { speak, stop as stopSpeech, ensureAudioReady, setVolume } from "../../utils/speech-playback"
import SettingsRow from "./SettingsRow"

// ─── Helpers ──────────────────────────────────────────────

const INTERACTION_MODES = [
	{ value: "assist", label: "Assist -- speak important responses" },
	{ value: "conversation", label: "Conversation -- speak all replies" },
	{ value: "minimal", label: "Minimal -- speak only on request" },
]

const EMPHASIS_OPTIONS = [
	{ value: "none", label: "None" },
	{ value: "reduced", label: "Reduced" },
	{ value: "moderate", label: "Moderate" },
	{ value: "strong", label: "Strong" },
]

const AUDIO_FORMATS = [
	{ value: "audio-16khz-32kbitrate-mono-mp3", label: "Low (16kHz)" },
	{ value: "audio-24khz-48kbitrate-mono-mp3", label: "Standard (24kHz)" },
	{ value: "audio-48khz-96kbitrate-mono-mp3", label: "High (48kHz)" },
]

const inputStyle = {
	width: "100%",
	padding: "4px 8px",
	border: "1px solid var(--vscode-input-border)",
	background: "var(--vscode-input-background)",
	color: "var(--vscode-input-foreground)",
	"border-radius": "2px",
	"font-size": "13px",
}

const sliderStyle = {
	width: "100%",
	"accent-color": "var(--vscode-focusBorder)",
}

const chipStyle = (active: boolean) => ({
	display: "inline-flex",
	"align-items": "center",
	gap: "4px",
	padding: "2px 8px",
	"border-radius": "12px",
	"font-size": "12px",
	cursor: "pointer",
	border: `1px solid ${active ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)"}`,
	background: active ? "var(--vscode-badge-background)" : "transparent",
	color: active ? "var(--vscode-badge-foreground)" : "var(--vscode-foreground)",
})

const sectionHeaderStyle = (clickable: boolean) => ({
	display: "flex",
	"align-items": "center",
	"justify-content": "space-between",
	padding: "8px 12px",
	cursor: clickable ? "pointer" : "default",
	"user-select": "none" as const,
	"font-weight": "600",
	"font-size": "13px",
})

// ─── Component ────────────────────────────────────────────

const SpeechTab: Component = () => {
	const vscode = useVSCode()

	// --- State ---
	const [settings, setSettings] = createSignal<SpeechSettings>({ ...DEFAULT_SPEECH_SETTINGS })
	const [connectionOpen, setConnectionOpen] = createSignal(true)
	const [tuningOpen, setTuningOpen] = createSignal(false)
	const [azureKeyStatus, setAzureKeyStatus] = createSignal<"unknown" | "checking" | "valid" | "invalid">("unknown")
	const [azureKeyError, setAzureKeyError] = createSignal("")
	const [searchQuery, setSearchQuery] = createSignal("")
	const [localeFilter, setLocaleFilter] = createSignal("all")
	const [selectedVoice, setSelectedVoice] = createSignal<AzureVoice | null>(null)
	const [previewText, setPreviewText] = createSignal("Hello! I'm your AI coding assistant. How can I help you today?")
	const [previewing, setPreviewing] = createSignal(false)
	const [newWord, setNewWord] = createSignal("")
	const [newPronunciation, setNewPronunciation] = createSignal("")
	const [presetName, setPresetName] = createSignal("")

	// --- Message handler ---
	const unsubscribe = vscode.onMessage((message: ExtensionMessage) => {
		if (message.type === "speechSettingsLoaded") {
			setSettings(message.settings)
			const voice = AZURE_VOICES.find((v) => v.id === message.settings.azure.voiceId)
			if (voice) setSelectedVoice(voice)
		}
		if (message.type === "azureKeyValidationResult") {
			setAzureKeyStatus(message.valid ? "valid" : "invalid")
			if (message.error) setAzureKeyError(message.error)
		}
	})

	onCleanup(() => {
		unsubscribe()
		stopSpeech()
	})

	vscode.postMessage({ type: "requestSpeechSettings" })

	// --- Save helpers ---
	const save = (key: string, value: unknown) => {
		vscode.postMessage({ type: "updateSetting", key: `speech.${key}`, value })
	}

	const updateField = <K extends keyof SpeechSettings>(key: K, value: SpeechSettings[K]) => {
		setSettings((prev) => ({ ...prev, [key]: value }))
		save(key, value)
	}

	const updateAzure = (key: string, value: unknown) => {
		setSettings((prev) => ({
			...prev,
			azure: { ...prev.azure, [key]: value },
		}))
		save(`azure.${key}`, value)
	}

	const updateTuning = (key: string, value: unknown) => {
		setSettings((prev) => ({
			...prev,
			tuning: { ...prev.tuning, [key]: value },
		}))
		save(`tuning.${key}`, value)
	}

	const updateFavorites = (key: string, value: unknown) => {
		setSettings((prev) => ({
			...prev,
			favorites: { ...prev.favorites, [key]: value },
		}))
		save(`favorites.${key}`, value)
	}

	// --- Computed ---
	const filteredVoices = createMemo(() => {
		let voices = AZURE_VOICES
		const q = searchQuery().toLowerCase()
		if (q) {
			voices = voices.filter(
				(v) =>
					v.name.toLowerCase().includes(q) ||
					v.id.toLowerCase().includes(q) ||
					v.description.toLowerCase().includes(q),
			)
		}
		const loc = localeFilter()
		if (loc !== "all") {
			voices = voices.filter((v) => v.locale === loc)
		}
		return voices
	})

	const currentVoiceStyles = createMemo(() => {
		return selectedVoice()?.styles ?? []
	})

	const isStarred = (voiceId: string) => settings().favorites.starredVoices.includes(voiceId)

	// --- Actions ---
	const validateKey = () => {
		const s = settings()
		if (!s.azure.apiKey || !s.azure.region) return
		setAzureKeyStatus("checking")
		setAzureKeyError("")
		vscode.postMessage({
			type: "validateAzureKey",
			apiKey: s.azure.apiKey,
			region: s.azure.region,
		})
	}

	const selectVoice = (voice: AzureVoice) => {
		setSelectedVoice(voice)
		updateAzure("voiceId", voice.id)
		setTuningOpen(true)
		// Reset style if new voice doesn't support current style
		const s = settings()
		if (s.tuning.style !== "default" && !voice.styles.includes(s.tuning.style)) {
			updateTuning("style", "default")
		}
	}

	const toggleStar = (voiceId: string) => {
		const starred = [...settings().favorites.starredVoices]
		const order = [...settings().favorites.order]
		const idx = starred.indexOf(voiceId)
		if (idx >= 0) {
			starred.splice(idx, 1)
			const oi = order.indexOf(voiceId)
			if (oi >= 0) order.splice(oi, 1)
		} else {
			starred.push(voiceId)
			order.push(voiceId)
		}
		updateFavorites("starredVoices", starred)
		updateFavorites("order", order)
	}

	const handlePreview = async (voiceId?: string) => {
		const s = settings()
		if (!s.azure.apiKey || !s.azure.region) return
		setPreviewing(true)
		ensureAudioReady()
		try {
			await speak(previewText(), {
				region: s.azure.region,
				apiKey: s.azure.apiKey,
				voiceId: voiceId ?? s.azure.voiceId,
				pitch: s.tuning.pitch,
				rate: s.tuning.rate,
				volume: s.tuning.volume ?? undefined,
				style: s.tuning.style,
				styleDegree: s.tuning.styleDegree,
				emphasis: s.tuning.emphasis,
				pronunciations: s.tuning.pronunciations,
				audioFormat: s.tuning.audioFormat,
				globalVolume: s.volume,
			})
		} catch (err: any) {
			console.error("[Speech] Preview failed:", err)
		} finally {
			setPreviewing(false)
		}
	}

	const addPronunciation = () => {
		const w = newWord().trim()
		const p = newPronunciation().trim()
		if (!w || !p) return
		const list = [...settings().tuning.pronunciations, { word: w, pronounceAs: p }]
		updateTuning("pronunciations", list)
		setNewWord("")
		setNewPronunciation("")
	}

	const removePronunciation = (idx: number) => {
		const list = settings().tuning.pronunciations.filter((_, i) => i !== idx)
		updateTuning("pronunciations", list)
	}

	const savePreset = () => {
		const name = presetName().trim()
		if (!name) return
		const s = settings()
		const preset: VoicePreset = {
			name,
			voiceId: s.azure.voiceId,
			pitch: s.tuning.pitch,
			rate: s.tuning.rate,
			volume: s.tuning.volume,
			style: s.tuning.style,
			styleDegree: s.tuning.styleDegree,
			sentencePause: s.tuning.sentencePause,
			paragraphBreak: s.tuning.paragraphBreak,
			emphasis: s.tuning.emphasis,
			pronunciations: [...s.tuning.pronunciations],
			audioFormat: s.tuning.audioFormat,
		}
		const presets = [...s.presets, preset]
		updateField("presets", presets)
		setPresetName("")
	}

	const loadPreset = (preset: VoicePreset) => {
		updateAzure("voiceId", preset.voiceId)
		const voice = AZURE_VOICES.find((v) => v.id === preset.voiceId)
		if (voice) setSelectedVoice(voice)
		updateTuning("pitch", preset.pitch)
		updateTuning("rate", preset.rate)
		updateTuning("volume", preset.volume)
		updateTuning("style", preset.style)
		updateTuning("styleDegree", preset.styleDegree)
		updateTuning("sentencePause", preset.sentencePause)
		updateTuning("paragraphBreak", preset.paragraphBreak)
		updateTuning("emphasis", preset.emphasis)
		updateTuning("pronunciations", [...preset.pronunciations])
		updateTuning("audioFormat", preset.audioFormat)
		setTuningOpen(true)
	}

	const deletePreset = (idx: number) => {
		const presets = settings().presets.filter((_, i) => i !== idx)
		updateField("presets", presets)
	}

	// ─── Render ───────────────────────────────────────────

	return (
		<div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>

			{/* ═══ SECTION 1: Connection + Global Settings ═══ */}
			<Card>
				<div
					style={sectionHeaderStyle(true)}
					onClick={() => setConnectionOpen(!connectionOpen())}
				>
					<span style={{ display: "flex", "align-items": "center", gap: "8px" }}>
						{connectionOpen() ? "▾" : "▸"} Connection & Global Settings
					</span>
					<span
						style={{
							width: "8px",
							height: "8px",
							"border-radius": "50%",
							background:
								azureKeyStatus() === "valid"
									? "var(--vscode-testing-iconPassed)"
									: azureKeyStatus() === "invalid"
										? "var(--vscode-testing-iconFailed)"
										: "var(--vscode-panel-border)",
						}}
						title={azureKeyStatus() === "valid" ? "Connected" : azureKeyStatus() === "invalid" ? azureKeyError() : "Not validated"}
					/>
				</div>
				<Show when={connectionOpen()}>
					<div style={{ padding: "0 12px 12px" }}>
						{/* API Key */}
						<SettingsRow
							title="Azure API Key"
							description="Your Azure Cognitive Services Speech API key"
						>
							<div style={{ display: "flex", gap: "4px", "align-items": "center" }}>
								<input
									type="password"
									value={settings().azure.apiKey}
									onInput={(e) => updateAzure("apiKey", e.currentTarget.value)}
									onBlur={validateKey}
									placeholder="Enter API key..."
									style={{ ...inputStyle, flex: "1" }}
								/>
								<Button
									variant="secondary"
									size="small"
									onClick={validateKey}
									disabled={azureKeyStatus() === "checking"}
								>
									{azureKeyStatus() === "checking" ? "..." : "Test"}
								</Button>
							</div>
						</SettingsRow>

						{/* Region */}
						<SettingsRow
							title="Azure Region"
							description="The region of your Azure Speech resource (e.g. westus, eastus, uksouth)"
						>
							<input
								type="text"
								value={settings().azure.region}
								onInput={(e) => updateAzure("region", e.currentTarget.value)}
								onBlur={validateKey}
								placeholder="westus"
								style={inputStyle}
							/>
						</SettingsRow>

						{/* Enable Speech */}
						<SettingsRow
							title="Enable Speech"
							description="Turn on voice output for AI responses"
						>
							<Switch
								checked={settings().enabled}
								onChange={(checked) => updateField("enabled", checked)}
								hideLabel
							>
								Enable Speech
							</Switch>
						</SettingsRow>

						{/* Auto-Speak */}
						<SettingsRow
							title="Auto-Speak"
							description="Automatically speak assistant replies when they finish"
						>
							<Switch
								checked={settings().autoSpeak}
								onChange={(checked) => updateField("autoSpeak", checked)}
								hideLabel
							>
								Auto-Speak
							</Switch>
						</SettingsRow>

						{/* Interaction Mode */}
						<SettingsRow
							title="Interaction Mode"
							description="Controls when and how voice responses are triggered"
						>
							<Select
								options={INTERACTION_MODES}
								current={INTERACTION_MODES.find((o) => o.value === settings().interactionMode)}
								value={(o) => o.value}
								label={(o) => o.label}
								onSelect={(o) => {
									if (o) updateField("interactionMode", o.value)
								}}
								variant="secondary"
								size="small"
								triggerVariant="settings"
							/>
						</SettingsRow>

						{/* Global Volume */}
						<SettingsRow
							title={`Volume: ${settings().volume}%`}
							description="Master volume for all speech output"
						>
							<input
								type="range"
								min="0"
								max="100"
								value={settings().volume}
								onInput={(e) => {
									const v = parseInt(e.currentTarget.value)
									updateField("volume", v)
									setVolume(v)
								}}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Stop on Typing */}
						<SettingsRow
							title="Stop on Typing"
							description="Interrupt speech playback when you start typing"
						>
							<Switch
								checked={settings().interruptOnType}
								onChange={(checked) => updateField("interruptOnType", checked)}
								hideLabel
							>
								Stop on Typing
							</Switch>
						</SettingsRow>

						{/* Sentiment Intensity */}
						<SettingsRow
							title={`Sentiment Intensity: ${settings().sentimentIntensity}%`}
							description="How strongly pitch and rate shift to match the emotional tone of responses"
						>
							<input
								type="range"
								min="0"
								max="100"
								value={settings().sentimentIntensity}
								onInput={(e) => updateField("sentimentIntensity", parseInt(e.currentTarget.value))}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Multi-Voice */}
						<SettingsRow
							title="Multi-Voice Dialogue"
							description="Each AI agent speaks in a distinct voice when multiple agents are active"
						>
							<Switch
								checked={settings().multiVoiceMode}
								onChange={(checked) => updateField("multiVoiceMode", checked)}
								hideLabel
							>
								Multi-Voice
							</Switch>
						</SettingsRow>

						{/* Debug Mode */}
						<SettingsRow
							title="Debug Mode"
							description="Show verbose speech engine logs in the developer console"
							last
						>
							<Switch
								checked={settings().debugMode}
								onChange={(checked) => updateField("debugMode", checked)}
								hideLabel
							>
								Debug
							</Switch>
						</SettingsRow>
					</div>
				</Show>
			</Card>

			{/* ═══ SECTION 2: Voice Browser + Favorites ═══ */}
			<Card>
				<div style={sectionHeaderStyle(false)}>
					Voice Browser & Favorites
				</div>
				<div style={{ padding: "0 12px 12px" }}>

					{/* Favorites Bar */}
					<Show when={settings().favorites.starredVoices.length > 0}>
						<div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px", "margin-bottom": "8px" }}>
							<For each={settings().favorites.starredVoices}>
								{(voiceId) => {
									const voice = AZURE_VOICES.find((v) => v.id === voiceId)
									return (
										<span
											style={chipStyle(settings().azure.voiceId === voiceId)}
											onClick={() => voice && selectVoice(voice)}
											title={voiceId}
										>
											&#9733; {voice?.name ?? voiceId}
										</span>
									)
								}}
							</For>
							<For each={settings().presets}>
								{(preset) => (
									<span
										style={chipStyle(false)}
										onClick={() => loadPreset(preset)}
										title={`Preset: ${preset.name}`}
									>
										# {preset.name}
									</span>
								)}
							</For>
						</div>
					</Show>

					{/* Search + Locale Filter */}
					<div style={{ display: "flex", gap: "8px", "margin-bottom": "8px" }}>
						<input
							type="text"
							placeholder="Search voices..."
							value={searchQuery()}
							onInput={(e) => setSearchQuery(e.currentTarget.value)}
							style={{ ...inputStyle, flex: "1" }}
						/>
						<select
							value={localeFilter()}
							onChange={(e) => setLocaleFilter(e.currentTarget.value)}
							style={{
								...inputStyle,
								width: "auto",
								"min-width": "120px",
							}}
						>
							<option value="all">All Locales</option>
							<For each={AZURE_LOCALES}>
								{(loc) => (
									<option value={loc}>{LOCALE_NAMES[loc] ?? loc}</option>
								)}
							</For>
						</select>
					</div>

					{/* Preview Text */}
					<div style={{ "margin-bottom": "8px" }}>
						<textarea
							value={previewText()}
							onInput={(e) => setPreviewText(e.currentTarget.value)}
							placeholder="Preview text..."
							rows={2}
							style={{
								...inputStyle,
								resize: "vertical",
								"font-family": "inherit",
							}}
						/>
					</div>

					{/* Voice List */}
					<div
						style={{
							"max-height": "320px",
							overflow: "auto",
							border: "1px solid var(--vscode-panel-border)",
							"border-radius": "4px",
						}}
					>
						<For each={filteredVoices()}>
							{(voice) => (
								<div
									style={{
										display: "flex",
										"align-items": "center",
										padding: "6px 10px",
										gap: "8px",
										cursor: "pointer",
										background:
											selectedVoice()?.id === voice.id
												? "var(--vscode-list-activeSelectionBackground)"
												: "transparent",
										color:
											selectedVoice()?.id === voice.id
												? "var(--vscode-list-activeSelectionForeground)"
												: "var(--vscode-foreground)",
										"border-bottom": "1px solid var(--vscode-panel-border)",
									}}
									onClick={() => selectVoice(voice)}
								>
									{/* Star */}
									<span
										style={{
											cursor: "pointer",
											"font-size": "14px",
											color: isStarred(voice.id)
												? "var(--vscode-charts-yellow)"
												: "var(--vscode-descriptionForeground)",
										}}
										onClick={(e) => {
											e.stopPropagation()
											toggleStar(voice.id)
										}}
										title={isStarred(voice.id) ? "Remove from favorites" : "Add to favorites"}
									>
										{isStarred(voice.id) ? "★" : "☆"}
									</span>
									{/* Info */}
									<div style={{ flex: "1", "min-width": "0" }}>
										<div style={{ "font-size": "13px", "font-weight": "500" }}>
											{voice.name}
											<span
												style={{
													"margin-left": "6px",
													"font-size": "11px",
													color: "var(--vscode-descriptionForeground)",
												}}
											>
												{voice.gender} · {voice.locale}
											</span>
										</div>
										<div
											style={{
												"font-size": "11px",
												color: "var(--vscode-descriptionForeground)",
												"white-space": "nowrap",
												overflow: "hidden",
												"text-overflow": "ellipsis",
											}}
										>
											{voice.description}
											<Show when={voice.styles.length > 0}>
												{" "}· Styles: {voice.styles.join(", ")}
											</Show>
										</div>
									</div>
									{/* Preview button */}
									<Button
										variant="secondary"
										size="small"
										onClick={(e: MouseEvent) => {
											e.stopPropagation()
											handlePreview(voice.id)
										}}
										disabled={previewing() || !settings().azure.apiKey}
									>
										{previewing() ? "..." : "▶"}
									</Button>
								</div>
							)}
						</For>
						<Show when={filteredVoices().length === 0}>
							<div
								style={{
									padding: "16px",
									"text-align": "center",
									color: "var(--vscode-descriptionForeground)",
								}}
							>
								No voices match your search
							</div>
						</Show>
					</div>

					<div style={{ "margin-top": "4px", "font-size": "11px", color: "var(--vscode-descriptionForeground)" }}>
						{filteredVoices().length} voices · Selected: {selectedVoice()?.name ?? "none"}
					</div>
				</div>
			</Card>

			{/* ═══ SECTION 3: Voice Fine-Tuning ═══ */}
			<Card>
				<div
					style={sectionHeaderStyle(true)}
					onClick={() => setTuningOpen(!tuningOpen())}
				>
					{tuningOpen() ? "▾" : "▸"} Voice Fine-Tuning
					<Show when={selectedVoice()}>
						<span style={{ "font-weight": "400", "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
							{selectedVoice()!.name}
						</span>
					</Show>
				</div>
				<Show when={tuningOpen()}>
					<div style={{ padding: "0 12px 12px" }}>

						{/* Pitch */}
						<SettingsRow
							title={`Pitch: ${settings().tuning.pitch > 0 ? "+" : ""}${settings().tuning.pitch}%`}
							description="Adjust voice pitch higher or lower (-50% to +50%)"
						>
							<input
								type="range"
								min="-50"
								max="50"
								value={settings().tuning.pitch}
								onInput={(e) => updateTuning("pitch", parseInt(e.currentTarget.value))}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Rate */}
						<SettingsRow
							title={`Rate: ${settings().tuning.rate.toFixed(1)}x`}
							description="Speech speed -- slower for clarity, faster for efficiency (0.5x to 2.0x)"
						>
							<input
								type="range"
								min="50"
								max="200"
								value={Math.round(settings().tuning.rate * 100)}
								onInput={(e) => updateTuning("rate", parseInt(e.currentTarget.value) / 100)}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Per-Voice Volume */}
						<SettingsRow
							title={settings().tuning.volume != null ? `Voice Volume: ${settings().tuning.volume}%` : "Voice Volume: Global"}
							description="Override volume for this voice, or use the global setting"
						>
							<div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
								<input
									type="range"
									min="0"
									max="100"
									value={settings().tuning.volume ?? settings().volume}
									onInput={(e) => updateTuning("volume", parseInt(e.currentTarget.value))}
									disabled={settings().tuning.volume == null}
									style={{ ...sliderStyle, flex: "1", opacity: settings().tuning.volume == null ? "0.4" : "1" }}
								/>
								<label style={{ "font-size": "11px", display: "flex", "align-items": "center", gap: "4px", "white-space": "nowrap" }}>
									<input
										type="checkbox"
										checked={settings().tuning.volume == null}
										onChange={(e) => {
											if (e.currentTarget.checked) {
												updateTuning("volume", null)
											} else {
												updateTuning("volume", settings().volume)
											}
										}}
									/>
									Use global
								</label>
							</div>
						</SettingsRow>

						{/* Style Chips */}
						<Show when={currentVoiceStyles().length > 0}>
							<SettingsRow
								title="Speaking Style"
								description="Emotional tone applied to the voice (available styles depend on the selected voice)"
							>
								<div style={{ display: "flex", "flex-wrap": "wrap", gap: "4px" }}>
									<span
										style={chipStyle(settings().tuning.style === "default")}
										onClick={() => updateTuning("style", "default")}
									>
										default
									</span>
									<For each={currentVoiceStyles()}>
										{(style) => (
											<span
												style={chipStyle(settings().tuning.style === style)}
												onClick={() => updateTuning("style", style)}
											>
												{style}
											</span>
										)}
									</For>
								</div>
							</SettingsRow>
						</Show>

						{/* Style Intensity */}
						<Show when={settings().tuning.style !== "default" && currentVoiceStyles().length > 0}>
							<SettingsRow
								title={`Style Intensity: ${settings().tuning.styleDegree.toFixed(1)}x`}
								description="How strongly the speaking style is applied (0.5x to 2.0x)"
							>
								<input
									type="range"
									min="50"
									max="200"
									value={Math.round(settings().tuning.styleDegree * 100)}
									onInput={(e) => updateTuning("styleDegree", parseInt(e.currentTarget.value) / 100)}
									style={sliderStyle}
								/>
							</SettingsRow>
						</Show>

						{/* Sentence Pause */}
						<SettingsRow
							title={`Sentence Pause: ${settings().tuning.sentencePause}ms`}
							description="Silence inserted between sentences (0-2000ms)"
						>
							<input
								type="range"
								min="0"
								max="2000"
								step="50"
								value={settings().tuning.sentencePause}
								onInput={(e) => updateTuning("sentencePause", parseInt(e.currentTarget.value))}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Paragraph Break */}
						<SettingsRow
							title={`Paragraph Break: ${settings().tuning.paragraphBreak}ms`}
							description="Longer silence between paragraphs (0-5000ms)"
						>
							<input
								type="range"
								min="0"
								max="5000"
								step="100"
								value={settings().tuning.paragraphBreak}
								onInput={(e) => updateTuning("paragraphBreak", parseInt(e.currentTarget.value))}
								style={sliderStyle}
							/>
						</SettingsRow>

						{/* Emphasis */}
						<SettingsRow
							title="Emphasis"
							description="Controls how strongly words are stressed in speech"
						>
							<Select
								options={EMPHASIS_OPTIONS}
								current={EMPHASIS_OPTIONS.find((o) => o.value === settings().tuning.emphasis)}
								value={(o) => o.value}
								label={(o) => o.label}
								onSelect={(o) => {
									if (o) updateTuning("emphasis", o.value)
								}}
								variant="secondary"
								size="small"
								triggerVariant="settings"
							/>
						</SettingsRow>

						{/* Custom Pronunciations */}
						<SettingsRow
							title="Custom Pronunciations"
							description="Override how technical terms or names are spoken"
						>
							<div>
								<For each={settings().tuning.pronunciations}>
									{(entry, idx) => (
										<div style={{ display: "flex", "align-items": "center", gap: "4px", "margin-bottom": "4px" }}>
											<span style={{ "font-size": "12px", flex: "1" }}>
												"{entry.word}" → "{entry.pronounceAs}"
											</span>
											<Button
												variant="secondary"
												size="small"
												onClick={() => removePronunciation(idx())}
											>
												✕
											</Button>
										</div>
									)}
								</For>
								<div style={{ display: "flex", gap: "4px", "margin-top": "4px" }}>
									<input
										type="text"
										placeholder="Word"
										value={newWord()}
										onInput={(e) => setNewWord(e.currentTarget.value)}
										style={{ ...inputStyle, flex: "1" }}
									/>
									<input
										type="text"
										placeholder="Pronounce as"
										value={newPronunciation()}
										onInput={(e) => setNewPronunciation(e.currentTarget.value)}
										style={{ ...inputStyle, flex: "1" }}
									/>
									<Button
										variant="secondary"
										size="small"
										onClick={addPronunciation}
										disabled={!newWord().trim() || !newPronunciation().trim()}
									>
										Add
									</Button>
								</div>
							</div>
						</SettingsRow>

						{/* Audio Quality */}
						<SettingsRow
							title="Audio Quality"
							description="Higher quality sounds better but uses more bandwidth and API quota"
						>
							<Select
								options={AUDIO_FORMATS}
								current={AUDIO_FORMATS.find((o) => o.value === settings().tuning.audioFormat)}
								value={(o) => o.value}
								label={(o) => o.label}
								onSelect={(o) => {
									if (o) updateTuning("audioFormat", o.value)
								}}
								variant="secondary"
								size="small"
								triggerVariant="settings"
							/>
						</SettingsRow>

						{/* Preview with tuning */}
						<div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
							<Button
								variant="secondary"
								size="small"
								onClick={() => handlePreview()}
								disabled={previewing() || !settings().azure.apiKey}
							>
								{previewing() ? "Playing..." : "▶ Play Preview"}
							</Button>
							<Button
								variant="secondary"
								size="small"
								onClick={() => stopSpeech()}
							>
								■ Stop
							</Button>
						</div>

						{/* Save as Preset */}
						<div
							style={{
								"margin-top": "12px",
								"padding-top": "12px",
								"border-top": "1px solid var(--vscode-panel-border)",
							}}
						>
							<div style={{ "font-size": "13px", "font-weight": "500", "margin-bottom": "6px" }}>
								Save as Preset
							</div>
							<div style={{ display: "flex", gap: "4px" }}>
								<input
									type="text"
									placeholder="Preset name..."
									value={presetName()}
									onInput={(e) => setPresetName(e.currentTarget.value)}
									style={{ ...inputStyle, flex: "1" }}
								/>
								<Button
									variant="secondary"
									size="small"
									onClick={savePreset}
									disabled={!presetName().trim()}
								>
									Save
								</Button>
							</div>

							{/* Saved Presets List */}
							<Show when={settings().presets.length > 0}>
								<div style={{ "margin-top": "8px" }}>
									<For each={settings().presets}>
										{(preset, idx) => (
											<div
												style={{
													display: "flex",
													"align-items": "center",
													gap: "4px",
													padding: "4px 0",
													"border-bottom": "1px solid var(--vscode-panel-border)",
												}}
											>
												<span style={{ flex: "1", "font-size": "12px" }}>
													{preset.name}
													<span style={{ color: "var(--vscode-descriptionForeground)", "margin-left": "6px" }}>
														{AZURE_VOICES.find((v) => v.id === preset.voiceId)?.name ?? preset.voiceId}
													</span>
												</span>
												<Button variant="secondary" size="small" onClick={() => loadPreset(preset)}>
													Load
												</Button>
												<Button variant="secondary" size="small" onClick={() => deletePreset(idx())}>
													✕
												</Button>
											</div>
										)}
									</For>
								</div>
							</Show>
						</div>
					</div>
				</Show>
			</Card>
		</div>
	)
}

export default SpeechTab
