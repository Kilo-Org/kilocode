import * as os from "node:os"

import * as vscode from "vscode"

type Platform = "mac" | "linux" | "windows" | "unknown"
type Architecture = "x64" | "arm64" | "unknown"

function getPlatform(): Platform {
	const platform = os.platform()
	if (platform === "darwin") {
		return "mac"
	} else if (platform === "linux") {
		return "linux"
	} else if (platform === "win32") {
		return "windows"
	} else {
		return "unknown"
	}
}

function getArchitecture(): Architecture {
	const arch = os.arch()
	if (arch === "x64" || arch === "ia32") {
		return "x64"
	} else if (arch === "arm64" || arch === "arm") {
		return "arm64"
	} else {
		return "unknown"
	}
}

export function isUnsupportedPlatform(): {
	isUnsupported: boolean
	reason?: string
} {
	const platform = getPlatform()
	const arch = getArchitecture()

	if (platform === "windows" && arch === "arm64") {
		return {
			isUnsupported: true,
			reason: "Windows ARM64 is not currently supported due to missing native dependencies (onnxruntime). Please use the extension on Windows x64, macOS, or Linux instead.",
		}
	}

	// if (platform === "unknown" || arch === "unknown") {
	//   return {
	//     isUnsupported: true,
	//     reason: `Unsupported platform combination: ${os.platform()}-${os.arch()}. Continue extension supports Windows x64, macOS (Intel/Apple Silicon), and Linux (x64/ARM64).`,
	//   };
	// }

	return { isUnsupported: false }
}

function getExtensionVersion(): string {
	const extension = vscode.extensions.getExtension("continue.continue")
	return extension?.packageJSON.version || "0.1.0"
}

export function isExtensionPrerelease(): boolean {
	const extensionVersion = getExtensionVersion()
	const versionParts = extensionVersion.split(".")
	if (versionParts.length >= 2) {
		const minorVersion = parseInt(versionParts[1], 10)
		if (!isNaN(minorVersion)) {
			return minorVersion % 2 !== 0
		}
	}
	return false
}
