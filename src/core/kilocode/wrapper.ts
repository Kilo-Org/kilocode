import * as vscode from "vscode"
import { JETBRAIN_PRODUCTS, KiloCodeWrapperProperties } from "../../shared/kilocode/wrapper"

export const getKiloCodeWrapperProperties = (): KiloCodeWrapperProperties => {
	const appName = vscode.env.appName
	const kiloCodeWrapped = appName?.includes("wrapper") ?? false
	let kiloCodeWrapper = null
	let kiloCodeWrapperTitle = null
	let kiloCodeWrapperCode = null
	let kiloCodeWrapperVersion = null
	let kiloCodeWrapperJetbrains = false

	if (kiloCodeWrapped) {
		const wrapperMatch = appName.split("|")
		kiloCodeWrapper = wrapperMatch[1].trim() || null
		kiloCodeWrapperCode = wrapperMatch[2].trim() || null
		kiloCodeWrapperVersion = wrapperMatch[3].trim() || null
		kiloCodeWrapperJetbrains = kiloCodeWrapperCode !== "cli"
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
		kiloCodeWrapperJetbrains,
	}
}

export const getEditorNameHeader = () => {
	const props = getKiloCodeWrapperProperties()
	return (
		props.kiloCodeWrapped
			? [props.kiloCodeWrapperTitle, props.kiloCodeWrapperVersion]
			: [vscode.env.appName || "VS Code", vscode.version]
	)
		.filter(Boolean)
		.join(" ")
}
