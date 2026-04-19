import * as vscode from "vscode"
import { execSync } from "child_process"
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import { KiloLogger } from "../KiloLogger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveryResult {
	providers: {
		ollama: { available: boolean; models: string[]; version?: string }
		lmstudio: { available: boolean; models: string[]; apiBase: string }
	}
	gpu: {
		detected: boolean
		name: string
		vramGb: number
		cudaVersion?: string
		driverVersion?: string
	}
	sshProfiles: Array<{
		name: string
		host: string
		port: number
		user: string
		identityFile?: string
		jumpHost?: string
	}>
	speech: {
		browserVoicesAvailable: boolean
		voiceCount: number
	}
	hardware: {
		cpuModel: string
		cpuCores: number
		ramGb: number
		platform: string
		arch: string
	}
	hermes: {
		configFound: boolean
		endpoint?: string
		reachable?: boolean
		version?: string
		error?: string
	}
	shiba: {
		configFound: boolean
		endpoint?: string
		reachable?: boolean
		connectedAgents?: string[]
		error?: string
	}
	zeroClaw: {
		configFound: boolean
		endpoint?: string
		reachable?: boolean
		defaultScope: string
		error?: string
	}
	timestamp: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = "kilocode.discoveryResult"
const LOG_PREFIX = "[Onboarding]"
const FETCH_TIMEOUT_MS = 3_000
const PROBE_TIMEOUT_MS = 2_000
const OLLAMA_BASE = "http://localhost:11434"
const LMSTUDIO_BASE = "http://localhost:1234"
const HERMES_DEFAULT_ENDPOINT = "http://localhost:7001"
const SHIBA_DEFAULT_ENDPOINT = "http://localhost:7002"
const ZEROCLAW_DEFAULT_ENDPOINT = "http://localhost:7003"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const svcLog = KiloLogger.for("OnboardingDiscovery")

function log(msg: string): void {
	svcLog.info(msg)
}

function logError(msg: string, err: unknown): void {
	svcLog.error(msg, err)
}

/**
 * Perform a fetch with an AbortController-based timeout.
 * Falls back gracefully when the global `fetch` is unavailable (older Node
 * runtimes bundled with some VS Code builds).
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, { signal: controller.signal })
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Extract a human-readable error message from an unknown error value.
 */
function errorMessage(err: unknown): string {
	if (err instanceof Error) {
		return err.message
	}
	if (typeof err === "string") {
		return err
	}
	try {
		return JSON.stringify(err)
	} catch {
		return String(err)
	}
}

/**
 * Locate a `.kilo/<filename>` config file, preferring the current workspace
 * and falling back to the user's home directory. Returns the absolute path
 * if found, or `undefined` otherwise.
 */
function resolveKiloConfigPath(filename: string): string | undefined {
	const candidates: string[] = []

	const workspaceFolders = vscode.workspace.workspaceFolders
	if (workspaceFolders && workspaceFolders.length > 0) {
		candidates.push(path.join(workspaceFolders[0].uri.fsPath, ".kilo", filename))
	}
	candidates.push(path.join(os.homedir(), ".kilo", filename))

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				return candidate
			}
		} catch {
			// Ignore individual access errors and keep probing.
		}
	}
	return undefined
}

/**
 * Read and parse a JSON config file, returning `undefined` on any failure.
 */
function readJsonConfig<T>(configPath: string): T | undefined {
	try {
		const raw = fs.readFileSync(configPath, "utf-8")
		return JSON.parse(raw) as T
	} catch (err) {
		logError(`Failed to parse config at ${configPath}`, err)
		return undefined
	}
}

// ---------------------------------------------------------------------------
// Default (empty) result
// ---------------------------------------------------------------------------

function emptyResult(): DiscoveryResult {
	const workspaceFolders = vscode.workspace.workspaceFolders
	const defaultScope =
		workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : ""

	return {
		providers: {
			ollama: { available: false, models: [] },
			lmstudio: { available: false, models: [], apiBase: LMSTUDIO_BASE },
		},
		gpu: { detected: false, name: "", vramGb: 0 },
		sshProfiles: [],
		speech: { browserVoicesAvailable: false, voiceCount: 0 },
		hardware: {
			cpuModel: "",
			cpuCores: 0,
			ramGb: 0,
			platform: os.platform(),
			arch: os.arch(),
		},
		hermes: { configFound: false },
		shiba: { configFound: false },
		zeroClaw: { configFound: false, defaultScope },
		timestamp: Date.now(),
	}
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OnboardingDiscoveryService implements vscode.Disposable {
	private cachedResult: DiscoveryResult | undefined
	private readonly workspaceState: vscode.Memento

	constructor(private readonly context: vscode.ExtensionContext) {
		this.workspaceState = context.workspaceState
		// Restore any previously cached result from workspace state.
		const persisted = this.workspaceState.get<DiscoveryResult>(CACHE_KEY)
		if (persisted) {
			this.cachedResult = persisted
		}
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Run all discovery probes in parallel, cache the result, and return it.
	 */
	async runFullDiscovery(): Promise<DiscoveryResult> {
		log("Starting full discovery...")
		try {
			const [providers, gpu, sshProfiles, hardware, hermes, shiba, zeroClaw] =
				await Promise.all([
					this.discoverLocalProviders(),
					this.detectGPU(),
					this.importSSHConfig(),
					this.detectHardware(),
					this.probeHermes(),
					this.probeShiba(),
					this.probeZeroClaw(),
				])

			const result: DiscoveryResult = {
				providers,
				gpu,
				sshProfiles,
				speech: {
					// VS Code's webview can enumerate SpeechSynthesis voices on the
					// frontend; from the extension host we simply flag availability.
					browserVoicesAvailable: true,
					voiceCount: 0,
				},
				hardware,
				hermes,
				shiba,
				zeroClaw,
				timestamp: Date.now(),
			}

			this.cachedResult = result
			await this.workspaceState.update(CACHE_KEY, result)
			log("Full discovery complete.")
			return result
		} catch (err) {
			logError("Full discovery failed, returning defaults", err)
			return emptyResult()
		}
	}

	/**
	 * Re-run discovery (alias kept for readability at call-sites).
	 */
	async refresh(): Promise<DiscoveryResult> {
		log("Refreshing discovery results...")
		return this.runFullDiscovery()
	}

	/**
	 * Return the most recent cached result, or `undefined` if discovery has
	 * not yet run.
	 */
	getCachedResult(): DiscoveryResult | undefined {
		return this.cachedResult
	}

	dispose(): void {
		log("Disposed.")
	}

	// -----------------------------------------------------------------------
	// Detectors (private)
	// -----------------------------------------------------------------------

	/**
	 * Probe Ollama and LM Studio local endpoints.
	 */
	private async discoverLocalProviders(): Promise<DiscoveryResult["providers"]> {
		const [ollama, lmstudio] = await Promise.all([
			this.probeOllama(),
			this.probeLMStudio(),
		])
		return { ollama, lmstudio }
	}

	private async probeOllama(): Promise<DiscoveryResult["providers"]["ollama"]> {
		try {
			const pingRes = await fetchWithTimeout(`${OLLAMA_BASE}/`, FETCH_TIMEOUT_MS)
			if (!pingRes.ok) {
				return { available: false, models: [] }
			}

			// Attempt to read the version from the root response.
			let version: string | undefined
			try {
				const body = await pingRes.text()
				// Ollama returns a plain text string like "Ollama is running"
				// but newer builds return JSON with a version field.
				if (body.startsWith("{")) {
					const json = JSON.parse(body)
					version = json.version
				}
			} catch {
				// Ignore parse errors.
			}

			// Fetch model list.
			const models: string[] = []
			try {
				const tagsRes = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, FETCH_TIMEOUT_MS)
				if (tagsRes.ok) {
					const tagsBody = (await tagsRes.json()) as { models?: Array<{ name: string }> }
					if (Array.isArray(tagsBody.models)) {
						for (const m of tagsBody.models) {
							if (m.name) {
								models.push(m.name)
							}
						}
					}
				}
			} catch {
				// Model listing is best-effort.
			}

			log(`Ollama detected (${models.length} model(s))`)
			return { available: true, models, version }
		} catch {
			return { available: false, models: [] }
		}
	}

	private async probeLMStudio(): Promise<DiscoveryResult["providers"]["lmstudio"]> {
		const base: DiscoveryResult["providers"]["lmstudio"] = {
			available: false,
			models: [],
			apiBase: LMSTUDIO_BASE,
		}

		try {
			const pingRes = await fetchWithTimeout(`${LMSTUDIO_BASE}/`, FETCH_TIMEOUT_MS)
			if (!pingRes.ok) {
				return base
			}

			// Fetch model list via OpenAI-compatible endpoint.
			const models: string[] = []
			try {
				const modelsRes = await fetchWithTimeout(
					`${LMSTUDIO_BASE}/v1/models`,
					FETCH_TIMEOUT_MS,
				)
				if (modelsRes.ok) {
					const body = (await modelsRes.json()) as { data?: Array<{ id: string }> }
					if (Array.isArray(body.data)) {
						for (const m of body.data) {
							if (m.id) {
								models.push(m.id)
							}
						}
					}
				}
			} catch {
				// Model listing is best-effort.
			}

			log(`LM Studio detected (${models.length} model(s))`)
			return { available: true, models, apiBase: LMSTUDIO_BASE }
		} catch {
			return base
		}
	}

	/**
	 * Detect GPU information using platform-specific tooling.
	 */
	private async detectGPU(): Promise<DiscoveryResult["gpu"]> {
		const none: DiscoveryResult["gpu"] = { detected: false, name: "", vramGb: 0 }

		// Try nvidia-smi first (works on Linux, Windows with NVIDIA drivers).
		try {
			const raw = execSync(
				"nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader,nounits",
				{ timeout: 5_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
			).trim()

			if (raw) {
				const parts = raw.split(",").map((s) => s.trim())
				const name = parts[0] ?? ""
				const vramMb = parseFloat(parts[1] ?? "0")
				const driverVersion = parts[2]

				log(`GPU detected via nvidia-smi: ${name}`)
				return {
					detected: true,
					name,
					vramGb: Math.round((vramMb / 1024) * 100) / 100,
					driverVersion,
				}
			}
		} catch {
			// nvidia-smi not available or failed.
		}

		// Windows fallback via PowerShell / CIM.
		if (os.platform() === "win32") {
			try {
				const raw = execSync(
					'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -First 1 -ExpandProperty Name"',
					{ timeout: 5_000, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
				).trim()

				if (raw) {
					log(`GPU detected via WMI: ${raw}`)
					return { detected: true, name: raw, vramGb: 0 }
				}
			} catch {
				// PowerShell fallback failed.
			}
		}

		return none
	}

	/**
	 * Parse `~/.ssh/config` to extract host profiles.
	 */
	private async importSSHConfig(): Promise<DiscoveryResult["sshProfiles"]> {
		const profiles: DiscoveryResult["sshProfiles"] = []

		try {
			const configPath = path.join(os.homedir(), ".ssh", "config")
			if (!fs.existsSync(configPath)) {
				return profiles
			}

			const content = fs.readFileSync(configPath, "utf-8")
			const lines = content.split(/\r?\n/)

			let current: (typeof profiles)[number] | null = null

			for (const rawLine of lines) {
				const line = rawLine.trim()

				// Skip comments and blank lines.
				if (!line || line.startsWith("#")) {
					continue
				}

				const match = /^(\S+)\s+(.+)$/.exec(line)
				if (!match) {
					continue
				}

				const key = match[1].toLowerCase()
				const value = match[2].trim()

				if (key === "host") {
					// Flush previous host.
					if (current) {
						profiles.push(current)
					}

					// Skip wildcard patterns.
					if (value.includes("*") || value.includes("?")) {
						current = null
						continue
					}

					current = {
						name: value,
						host: value,
						port: 22,
						user: os.userInfo().username,
					}
				} else if (current) {
					switch (key) {
						case "hostname":
							current.host = value
							break
						case "port":
							current.port = parseInt(value, 10) || 22
							break
						case "user":
							current.user = value
							break
						case "identityfile":
							current.identityFile = value.replace(/^~/, os.homedir())
							break
						case "proxyjump":
							current.jumpHost = value
							break
					}
				}
			}

			// Flush the last parsed host.
			if (current) {
				profiles.push(current)
			}

			log(`Imported ${profiles.length} SSH profile(s)`)
		} catch (err) {
			logError("Failed to parse SSH config", err)
		}

		return profiles
	}

	/**
	 * Detect basic hardware specs from Node's `os` module.
	 */
	private async detectHardware(): Promise<DiscoveryResult["hardware"]> {
		try {
			const cpus = os.cpus()
			const result: DiscoveryResult["hardware"] = {
				cpuModel: cpus[0]?.model ?? "unknown",
				cpuCores: cpus.length,
				ramGb: Math.round((os.totalmem() / 1024 ** 3) * 100) / 100,
				platform: os.platform(),
				arch: os.arch(),
			}
			log(`Hardware: ${result.cpuModel}, ${result.cpuCores} cores, ${result.ramGb} GB RAM`)
			return result
		} catch (err) {
			logError("Hardware detection failed", err)
			return {
				cpuModel: "unknown",
				cpuCores: 0,
				ramGb: 0,
				platform: os.platform(),
				arch: os.arch(),
			}
		}
	}

	/**
	 * Legacy Hermes detector. Kept as a thin wrapper over `probeHermes()` so
	 * existing callers that only inspect `configFound` continue to work.
	 */
	private async detectHermes(): Promise<DiscoveryResult["hermes"]> {
		return this.probeHermes()
	}

	/**
	 * Deep-probe Hermes: locate the config file (workspace or home), resolve
	 * the endpoint, hit `/health` with a 2s timeout, and report status.
	 */
	private async probeHermes(): Promise<DiscoveryResult["hermes"]> {
		const configPath = resolveKiloConfigPath("hermes.json")
		let configFound = false
		let endpoint = HERMES_DEFAULT_ENDPOINT

		if (configPath) {
			const parsed = readJsonConfig<{ endpoint?: string }>(configPath)
			configFound = true
			if (parsed?.endpoint && typeof parsed.endpoint === "string") {
				endpoint = parsed.endpoint
			}
			log(`Hermes config found at ${configPath}`)
		}

		try {
			const res = await fetchWithTimeout(`${endpoint}/health`, PROBE_TIMEOUT_MS)
			if (!res.ok) {
				const error = `Hermes /health returned HTTP ${res.status}`
				log(error)
				return { configFound, endpoint, reachable: false, error }
			}

			let version: string | undefined
			try {
				const body = await res.text()
				if (body.startsWith("{")) {
					const json = JSON.parse(body) as { version?: string }
					version = typeof json.version === "string" ? json.version : undefined
				}
			} catch {
				// /health returned non-JSON; ignore version extraction.
			}

			log(`Hermes reachable at ${endpoint}${version ? ` (v${version})` : ""}`)
			return { configFound, endpoint, reachable: true, version }
		} catch (err) {
			const error = errorMessage(err)
			logError(`Hermes probe failed at ${endpoint}`, err)
			return { configFound, endpoint, reachable: false, error }
		}
	}

	/**
	 * Deep-probe Shiba: locate the config file, resolve endpoint, hit
	 * `/health` with 2s timeout, and report reachable/connected agents.
	 */
	private async probeShiba(): Promise<DiscoveryResult["shiba"]> {
		const configPath = resolveKiloConfigPath("shiba.json")
		let configFound = false
		let endpoint = SHIBA_DEFAULT_ENDPOINT

		if (configPath) {
			const parsed = readJsonConfig<{ endpoint?: string }>(configPath)
			configFound = true
			if (parsed?.endpoint && typeof parsed.endpoint === "string") {
				endpoint = parsed.endpoint
			}
			log(`Shiba config found at ${configPath}`)
		}

		try {
			const res = await fetchWithTimeout(`${endpoint}/health`, PROBE_TIMEOUT_MS)
			if (!res.ok) {
				const error = `Shiba /health returned HTTP ${res.status}`
				log(error)
				return { configFound, endpoint, reachable: false, error }
			}

			let connectedAgents: string[] | undefined
			try {
				const body = await res.text()
				if (body.startsWith("{")) {
					const json = JSON.parse(body) as {
						connectedAgents?: unknown
						agents?: unknown
					}
					const raw = json.connectedAgents ?? json.agents
					if (Array.isArray(raw)) {
						connectedAgents = raw
							.map((entry) => {
								if (typeof entry === "string") {
									return entry
								}
								if (entry && typeof entry === "object") {
									const rec = entry as { id?: unknown; name?: unknown }
									if (typeof rec.id === "string") return rec.id
									if (typeof rec.name === "string") return rec.name
								}
								return undefined
							})
							.filter((v): v is string => typeof v === "string")
					}
				}
			} catch {
				// /health returned non-JSON; ignore agent extraction.
			}

			log(
				`Shiba reachable at ${endpoint}` +
					(connectedAgents ? ` (${connectedAgents.length} agent(s))` : ""),
			)
			return { configFound, endpoint, reachable: true, connectedAgents }
		} catch (err) {
			const error = errorMessage(err)
			logError(`Shiba probe failed at ${endpoint}`, err)
			return { configFound, endpoint, reachable: false, error }
		}
	}

	/**
	 * Deep-probe ZeroClaw: locate the config file, resolve endpoint, hit
	 * `/health` with 2s timeout, and attach the current workspace folder as
	 * the default scope.
	 */
	private async probeZeroClaw(): Promise<DiscoveryResult["zeroClaw"]> {
		const workspaceFolders = vscode.workspace.workspaceFolders
		const defaultScope =
			workspaceFolders && workspaceFolders.length > 0
				? workspaceFolders[0].uri.fsPath
				: ""

		const configPath = resolveKiloConfigPath("zeroclaw.json")
		let configFound = false
		let endpoint = ZEROCLAW_DEFAULT_ENDPOINT

		if (configPath) {
			const parsed = readJsonConfig<{ endpoint?: string }>(configPath)
			configFound = true
			if (parsed?.endpoint && typeof parsed.endpoint === "string") {
				endpoint = parsed.endpoint
			}
			log(`ZeroClaw config found at ${configPath}`)
		}

		try {
			const res = await fetchWithTimeout(`${endpoint}/health`, PROBE_TIMEOUT_MS)
			if (!res.ok) {
				const error = `ZeroClaw /health returned HTTP ${res.status}`
				log(error)
				return { configFound, endpoint, reachable: false, defaultScope, error }
			}

			log(`ZeroClaw reachable at ${endpoint}`)
			return { configFound, endpoint, reachable: true, defaultScope }
		} catch (err) {
			const error = errorMessage(err)
			logError(`ZeroClaw probe failed at ${endpoint}`, err)
			return { configFound, endpoint, reachable: false, defaultScope, error }
		}
	}
}
