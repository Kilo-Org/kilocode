import { JETBRAIN_PRODUCTS, KiloCodeWrapperProperties } from "../../../../src/shared/kilocode/wrapper"
import { getAppUrl } from "@roo-code/types"

const getJetbrainsUrlScheme = (code: string) => {
	return JETBRAIN_PRODUCTS[code as keyof typeof JETBRAIN_PRODUCTS]?.urlScheme || "jetbrains"
}

const getKiloCodeSource = (uriScheme: string = "vscode", kiloCodeWrapperProperties?: KiloCodeWrapperProperties) => {
	if (
		!kiloCodeWrapperProperties?.kiloCodeWrapped ||
		!kiloCodeWrapperProperties.kiloCodeWrapper ||
		!kiloCodeWrapperProperties.kiloCodeWrapperCode
	) {
		return uriScheme
	}

	return `${getJetbrainsUrlScheme(kiloCodeWrapperProperties.kiloCodeWrapperCode)}`
}

export function getKiloCodeBackendSignInUrl(
	uriScheme: string = "vscode",
	uiKind: string = "Desktop",
	kiloCodeWrapperProperties?: KiloCodeWrapperProperties,
) {
	const source = uiKind === "Web" ? "web" : getKiloCodeSource(uriScheme, kiloCodeWrapperProperties)
	return getAppUrl(`/sign-in-to-editor?source=${source}`)
}

export function getKiloCodeBackendSignUpUrl(
	uriScheme: string = "vscode",
	uiKind: string = "Desktop",
	kiloCodeWrapperProperties?: KiloCodeWrapperProperties,
) {
	const source = uiKind === "Web" ? "web" : getKiloCodeSource(uriScheme, kiloCodeWrapperProperties)
	return getAppUrl(`/users/sign_up?source=${source}`)
}
