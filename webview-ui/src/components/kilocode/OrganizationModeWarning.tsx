import { useAppTranslation } from "@/i18n/TranslationContext"

export function OrganizationModeWarning() {
	const { t } = useAppTranslation()
	return (
		<div className="mb-4 p-3 border border-vscode-inputValidation-infoBorder rounded">
			<div className="flex items-start gap-2">
				<span className="codicon codicon-organization mt-0.5"></span>
				<div className="text-sm ">
					<div className="font-semibold mb-1">{t("prompts:organizationMode.title")}</div>
					<div>{t("prompts:organizationMode.description")}</div>
				</div>
			</div>
		</div>
	)
}
