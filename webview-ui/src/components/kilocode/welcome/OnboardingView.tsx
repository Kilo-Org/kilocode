// kilocode_change - new file
import React from "react"
import Logo from "../common/Logo"
import { useAppTranslation } from "@/i18n/TranslationContext"

interface OnboardingOptionProps {
	title: string
	description: string
	icon: string
	onClick: () => void
}

const OnboardingOption: React.FC<OnboardingOptionProps> = ({ title, description, icon, onClick }) => {
	return (
		<button
			className="w-full p-5 rounded-lg border border-vscode-panel-border bg-vscode-editor-background hover:bg-vscode-list-hoverBackground cursor-pointer text-left transition-colors flex items-center gap-4"
			onClick={onClick}>
			<span
				className={`codicon codicon-${icon} text-vscode-foreground`}
				style={{ fontSize: "24px", width: "24px", height: "24px" }}
			/>
			<div>
				<h3 className="text-lg font-semibold text-vscode-foreground m-0 mb-2">{title}</h3>
				<p className="text-sm text-vscode-descriptionForeground m-0">{description}</p>
			</div>
		</button>
	)
}

interface OnboardingViewProps {
	onSelectFreeModels: () => void
	onSelectPremiumModels: () => void
	onSelectBYOK: () => void
}

const OnboardingView: React.FC<OnboardingViewProps> = ({ onSelectFreeModels, onSelectPremiumModels, onSelectBYOK }) => {
	const { t } = useAppTranslation()

	return (
		<div className="flex flex-col items-center justify-center min-h-screen p-6 bg-vscode-sideBar-background">
			<Logo width={80} height={80} />

			<h1 className="text-2xl font-bold text-vscode-foreground text-center mt-4 mb-10">
				{t("kilocode:onboarding.title")}
			</h1>

			<div className="w-full max-w-md flex flex-col gap-4">
				<OnboardingOption
					title={t("kilocode:onboarding.freeModels.title")}
					description={t("kilocode:onboarding.freeModels.description")}
					icon="sparkle"
					onClick={onSelectFreeModels}
				/>

				<OnboardingOption
					title={t("kilocode:onboarding.premiumModels.title")}
					description={t("kilocode:onboarding.premiumModels.description")}
					icon="star-full"
					onClick={onSelectPremiumModels}
				/>

				<OnboardingOption
					title={t("kilocode:onboarding.byok.title")}
					description={t("kilocode:onboarding.byok.description")}
					icon="key"
					onClick={onSelectBYOK}
				/>
			</div>
		</div>
	)
}

export default OnboardingView
