import { JETBRAIN_PRODUCTS, KiloCodeWrapperProperties } from "../../../../src/shared/kilocode/wrapper"

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
	return `https://app.matterai.so/authentication/sign-in?loginType=extension&source=${source}`
}

export function getKiloCodeBackendSignUpUrl(
	uriScheme: string = "vscode",
	uiKind: string = "Desktop",
	kiloCodeWrapperProperties?: KiloCodeWrapperProperties,
) {
	const source = uiKind === "Web" ? "web" : getKiloCodeSource(uriScheme, kiloCodeWrapperProperties)
	return `https://app.matterai.so/authentication/sign-in?loginType=extension&source=${source}`
}
