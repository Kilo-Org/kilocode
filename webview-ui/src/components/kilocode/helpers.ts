import { JETBRAIN_PRODUCTS } from "../../../../src/shared/kilocode/wrapper"
import { getAppUrl } from "@roo-code/types"

type WrapperPropsForWebview =
	| import("@roo-code/types").KiloCodeWrapperProperties
	| import("../../../../src/shared/kilocode/wrapper").KiloCodeWrapperProperties // kilocode_change

const getJetbrainsUrlScheme = (code: string) => {
	return JETBRAIN_PRODUCTS[code as keyof typeof JETBRAIN_PRODUCTS]?.urlScheme || "jetbrains"
}

const getKiloCodeSource = (uriScheme: string = "vscode", kiloCodeWrapperProperties?: WrapperPropsForWebview) => {
	if (
		!kiloCodeWrapperProperties?.kiloCodeWrapped ||
		!(kiloCodeWrapperProperties as any).kiloCodeWrapper ||
		!(kiloCodeWrapperProperties as any).kiloCodeWrapperCode
	) {
		return uriScheme
	}

	return `${getJetbrainsUrlScheme((kiloCodeWrapperProperties as any).kiloCodeWrapperCode)}` // kilocode_change
}

export function getKiloCodeBackendSignInUrl(
	uriScheme: string = "vscode",
	uiKind: string = "Desktop",
	kiloCodeWrapperProperties?: WrapperPropsForWebview, // kilocode_change
) {
	const source = uiKind === "Web" ? "web" : getKiloCodeSource(uriScheme, kiloCodeWrapperProperties)
	return getAppUrl(`/sign-in-to-editor?source=${source}`)
}

export function getKiloCodeBackendSignUpUrl(
	uriScheme: string = "vscode",
	uiKind: string = "Desktop",
	kiloCodeWrapperProperties?: WrapperPropsForWebview, // kilocode_change
) {
	const source = uiKind === "Web" ? "web" : getKiloCodeSource(uriScheme, kiloCodeWrapperProperties)
	return getAppUrl(`/users/sign_up?source=${source}`)
}
