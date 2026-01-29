import * as vscode from "vscode"
import { Package } from "../../../../shared/package"
import { getKiloCodeWrapperProperties } from "../../../../core/kilocode/wrapper"

/**
 * Get OCA client information with safe fallbacks.
 */
export function getOcaClientInfo(): {
	client: string
	clientVersion: string
	clientIde: string
	clientIdeVersion: string
} {
	let client = "kilocode"
	let clientVersion = ""
	let clientIde = ""
	let clientIdeVersion = ""

	try {
		client = Package.name
		clientVersion = Package.version

		const { kiloCodeWrapperTitle, kiloCodeWrapperVersion } = getKiloCodeWrapperProperties()

		clientIde = kiloCodeWrapperTitle || vscode.env.appName
		clientIdeVersion = kiloCodeWrapperVersion || vscode.version
	} catch (error) {
		console.warn("Failed to get client information for OCA headers:", error)
	}

	return {
		client,
		clientVersion,
		clientIde,
		clientIdeVersion,
	}
}
