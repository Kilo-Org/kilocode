import React from "react"
import { ButtonLink } from "./ButtonLink"
import { ButtonSecondary } from "./ButtonSecondary"
import Logo from "./Logo"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { getKiloCodeBackendSignUpUrl } from "../helpers"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface KiloCodeAuthProps {
	onManualConfigClick?: () => void
	className?: string
}

const KiloCodeAuth: React.FC<KiloCodeAuthProps> = ({ onManualConfigClick, className = "" }) => {
	const { uriScheme, uiKind, kiloCodeWrapperProperties } = useExtensionState()

	const { t } = useAppTranslation()

	return (
		<div className={`flex flex-col items-center ${className}`}>
			<Logo />

			<h2 className="m-0 p-0 mb-4">{t("kilocode:welcome.greeting")}</h2>
			<p className="text-center mb-2">{t("kilocode:welcome.introText1")}</p>
			<p className="text-center mb-2">{t("kilocode:welcome.introText2")}</p>
			<p className="text-center mb-5">{t("kilocode:welcome.introText3")}</p>

			<div className="w-full flex flex-col gap-5">
				<ButtonLink
					href={getKiloCodeBackendSignUpUrl(uriScheme, uiKind, kiloCodeWrapperProperties)}
					onClick={() => {
						if (uiKind === "Web" && onManualConfigClick) {
							onManualConfigClick()
						}
					}}>
					{t("kilocode:welcome.ctaButton")}
				</ButtonLink>

				{!!onManualConfigClick && (
					<ButtonSecondary onClick={() => onManualConfigClick && onManualConfigClick()}>
						{t("kilocode:welcome.manualModeButton")}
					</ButtonSecondary>
				)}
			</div>
		</div>
	)
}

export default KiloCodeAuth
