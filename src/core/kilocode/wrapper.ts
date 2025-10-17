import * as vscode from "vscode"
import { JETBRAIN_PRODUCTS, KiloCodeWrapperProperties } from "../../shared/kilocode/wrapper"

export const getKiloCodeWrapperProperties = (): KiloCodeWrapperProperties => {
	const appName = vscode.env.appName
	const kiloCodeWrapped = appName.includes("wrapper")
	let kiloCodeWrapper = null
	let kiloCodeWrapperTitle = null
	let kiloCodeWrapperCode = null
	let kiloCodeWrapperVersion = null

	if (kiloCodeWrapped) {
		const wrapperMatch = appName.split("|")
		kiloCodeWrapper = wrapperMatch[1].trim() || null
		kiloCodeWrapperCode = wrapperMatch[2].trim() || null
		kiloCodeWrapperVersion = wrapperMatch[3].trim() || null
		kiloCodeWrapperTitle =
			kiloCodeWrapperCode === "cli"
				? "Kilo Code CLI"
				: JETBRAIN_PRODUCTS[kiloCodeWrapperCode as keyof typeof JETBRAIN_PRODUCTS]?.name || "JetBrains IDE"
	}

	return {
		kiloCodeWrapped,
		kiloCodeWrapper,
		kiloCodeWrapperTitle,
		kiloCodeWrapperCode,
		kiloCodeWrapperVersion,
	}
}
