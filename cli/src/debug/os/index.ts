import os from "os"
import { execSync } from "child_process"
import osName from "os-name"
import isWsl from "is-wsl"

interface SystemInfo {
	os: {
		platform: string
		type: string
		release: string
		version: string
		name: string
		arch: string
		isWSL: boolean
	}
	hardware: {
		cpus: string
		cores: number
		totalMemory: string
		freeMemory: string
		uptime: string
	}
	environment: {
		nodeVersion: string
		shell: string
		terminal: string | null
		termProgram: string | null
		colorterm: string | null
		display: string | null
		waylandDisplay: string | null
		sessionType: string | null
		desktopSession: string | null
		xdgCurrentDesktop: string | null
		xdgSessionType: string | null
	}
	locale: {
		lang: string | null
		timezone: string
		encoding: string
	}
}

/**
 * Safely execute a command and return its output
 */
function safeExec(command: string): string | null {
	try {
		return execSync(command, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }).trim()
	} catch {
		return null
	}
}

/**
 * Format bytes to human-readable format
 */
function formatBytes(bytes: number): string {
	const gb = bytes / 1024 ** 3
	return `${gb.toFixed(2)} GB`
}

/**
 * Format uptime to human-readable format
 */
function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400)
	const hours = Math.floor((seconds % 86400) / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)

	const parts = []
	if (days > 0) parts.push(`${days}d`)
	if (hours > 0) parts.push(`${hours}h`)
	if (minutes > 0) parts.push(`${minutes}m`)

	return parts.length > 0 ? parts.join(" ") : "< 1m"
}

/**
 * Detect terminal emulator
 */
function detectTerminal(): string | null {
	// Check common terminal environment variables
	const termProgram = process.env.TERM_PROGRAM
	if (termProgram) return termProgram

	// Try to detect from parent process on Linux/macOS
	if (process.platform !== "win32") {
		const ppid = process.ppid
		if (ppid) {
			// Try ps command
			const psOutput = safeExec(`ps -p ${ppid} -o comm=`)
			if (psOutput) return psOutput

			// Try /proc on Linux
			if (process.platform === "linux") {
				const procComm = safeExec(`cat /proc/${ppid}/comm`)
				if (procComm) return procComm
			}
		}
	}

	// Fallback to TERM variable
	return process.env.TERM || null
}

/**
 * Get display server information (X11/Wayland)
 */
function getDisplayServerInfo(): string {
	const display = process.env.DISPLAY
	const waylandDisplay = process.env.WAYLAND_DISPLAY
	const sessionType = process.env.XDG_SESSION_TYPE

	if (waylandDisplay || sessionType === "wayland") {
		return "Wayland"
	} else if (display || sessionType === "x11") {
		return "X11"
	}

	return "Unknown"
}

/**
 * Gather comprehensive system information
 */
function gatherSystemInfo(): SystemInfo {
	const cpus = os.cpus()
	const cpuModel = cpus[0]?.model || "Unknown"

	return {
		os: {
			platform: process.platform,
			type: os.type(),
			release: os.release(),
			version: os.version(),
			name: osName(),
			arch: os.arch(),
			isWSL: isWsl,
		},
		hardware: {
			cpus: cpuModel,
			cores: cpus.length,
			totalMemory: formatBytes(os.totalmem()),
			freeMemory: formatBytes(os.freemem()),
			uptime: formatUptime(os.uptime()),
		},
		environment: {
			nodeVersion: process.version,
			shell: process.env.SHELL || "Unknown",
			terminal: detectTerminal(),
			termProgram: process.env.TERM_PROGRAM || null,
			colorterm: process.env.COLORTERM || null,
			display: process.env.DISPLAY || null,
			waylandDisplay: process.env.WAYLAND_DISPLAY || null,
			sessionType: process.env.XDG_SESSION_TYPE || null,
			desktopSession: process.env.DESKTOP_SESSION || null,
			xdgCurrentDesktop: process.env.XDG_CURRENT_DESKTOP || null,
			xdgSessionType: process.env.XDG_SESSION_TYPE || null,
		},
		locale: {
			lang: process.env.LANG || null,
			timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			encoding: "utf8",
		},
	}
}

/**
 * Print system information in a formatted way
 */
function printSystemInfo(info: SystemInfo): void {
	console.log("\n=== Operating System ===")
	console.log(`Name:           ${info.os.name}`)
	console.log(`Platform:       ${info.os.platform}`)
	console.log(`Type:           ${info.os.type}`)
	console.log(`Release:        ${info.os.release}`)
	console.log(`Architecture:   ${info.os.arch}`)
	console.log(`WSL:            ${info.os.isWSL ? "Yes" : "No"}`)

	console.log("\n=== Hardware ===")
	console.log(`CPU:            ${info.hardware.cpus}`)
	console.log(`Cores:          ${info.hardware.cores}`)
	console.log(`Total Memory:   ${info.hardware.totalMemory}`)
	console.log(`Free Memory:    ${info.hardware.freeMemory}`)
	console.log(`Uptime:         ${info.hardware.uptime}`)

	console.log("\n=== Environment ===")
	console.log(`Node Version:   ${info.environment.nodeVersion}`)
	console.log(`Shell:          ${info.environment.shell}`)
	console.log(`Terminal:       ${info.environment.terminal || "Unknown"}`)

	if (info.environment.termProgram) {
		console.log(`TERM_PROGRAM:   ${info.environment.termProgram}`)
	}

	if (info.environment.colorterm) {
		console.log(`COLORTERM:      ${info.environment.colorterm}`)
	}

	// Display server information (Linux/Unix)
	if (process.platform !== "win32") {
		const displayServer = getDisplayServerInfo()
		console.log(`Display Server: ${displayServer}`)

		if (info.environment.display) {
			console.log(`DISPLAY:        ${info.environment.display}`)
		}

		if (info.environment.waylandDisplay) {
			console.log(`WAYLAND_DISPLAY: ${info.environment.waylandDisplay}`)
		}

		if (info.environment.xdgSessionType) {
			console.log(`Session Type:   ${info.environment.xdgSessionType}`)
		}

		if (info.environment.xdgCurrentDesktop) {
			console.log(`Desktop:        ${info.environment.xdgCurrentDesktop}`)
		}
	}

	console.log("\n=== Locale ===")
	console.log(`Language:       ${info.locale.lang || "Not set"}`)
	console.log(`Timezone:       ${info.locale.timezone}`)
	console.log(`Encoding:       ${info.locale.encoding}`)

	// Additional platform-specific information
	if (process.platform === "linux") {
		console.log("\n=== Linux Specific ===")

		const distro = safeExec("cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d'=' -f2 | tr -d '\"'")
		if (distro) {
			console.log(`Distribution:   ${distro}`)
		}

		const kernel = safeExec("uname -r")
		if (kernel) {
			console.log(`Kernel:         ${kernel}`)
		}

		const glibcVersion = safeExec("ldd --version 2>/dev/null | head -n1")
		if (glibcVersion) {
			console.log(`glibc:          ${glibcVersion}`)
		}
	} else if (process.platform === "darwin") {
		console.log("\n=== macOS Specific ===")

		const macosVersion = safeExec("sw_vers -productVersion")
		if (macosVersion) {
			console.log(`macOS Version:  ${macosVersion}`)
		}

		const buildVersion = safeExec("sw_vers -buildVersion")
		if (buildVersion) {
			console.log(`Build Version:  ${buildVersion}`)
		}
	} else if (process.platform === "win32") {
		console.log("\n=== Windows Specific ===")

		const windowsVersion = safeExec("wmic os get Caption /value 2>nul | findstr Caption")
		if (windowsVersion) {
			console.log(`Windows:        ${windowsVersion.replace("Caption=", "")}`)
		}

		const buildNumber = safeExec("wmic os get BuildNumber /value 2>nul | findstr BuildNumber")
		if (buildNumber) {
			console.log(`Build Number:   ${buildNumber.replace("BuildNumber=", "")}`)
		}
	}

	console.log("\n=== Process Information ===")
	console.log(`PID:            ${process.pid}`)
	console.log(`Parent PID:     ${process.ppid}`)
	console.log(`Working Dir:    ${process.cwd()}`)
	console.log(`Executable:     ${process.execPath}`)
	console.log(`Arguments:      ${process.argv.slice(2).join(" ") || "None"}`)

	console.log("\n")
}

export const debugOS = async () => {
	console.log("Kilo Code - OS Debug Tool")

	try {
		const systemInfo = gatherSystemInfo()
		printSystemInfo(systemInfo)

		console.log("✓ OS debug information collected successfully")
	} catch (error) {
		console.error("✗ Error collecting OS debug information:", error)
		throw error
	}
}
