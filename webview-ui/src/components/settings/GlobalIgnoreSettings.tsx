import { X } from "lucide-react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { vscode } from "@/utils/vscode"
import { Button, Input } from "@/components/ui"
import { useState } from "react"
import { SetCachedStateField } from "./types"

interface GlobalIgnoreSettingsProps {
	globallyIgnoredFiles?: string[]
	alwaysAllowReadOnlyOutsideWorkspace?: boolean
	setCachedStateField: SetCachedStateField<"globallyIgnoredFiles" | "alwaysAllowReadOnlyOutsideWorkspace">
}

export const GlobalIgnoreSettings = ({
	globallyIgnoredFiles,
	alwaysAllowReadOnlyOutsideWorkspace,
	setCachedStateField,
}: GlobalIgnoreSettingsProps) => {
	const { t } = useAppTranslation()
	const [globalIgnoreInput, setGlobalIgnoreInput] = useState("")

	const handleAddGlobalIgnorePattern = () => {
		const currentPatterns = globallyIgnoredFiles ?? []

		if (globalIgnoreInput && !currentPatterns.includes(globalIgnoreInput)) {
			const newPatterns = [...currentPatterns, globalIgnoreInput]
			setCachedStateField("globallyIgnoredFiles", newPatterns)
			setGlobalIgnoreInput("")
			vscode.postMessage({ type: "updateSettings", updatedSettings: { globallyIgnoredFiles: newPatterns } })
		}
	}

	return (
		<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
			<div className="flex items-center gap-4 font-bold">
				<span className="codicon codicon-eye" />
				<div>{t("settings:autoApprove.readOnly.label")}</div>
			</div>
			<div>
				<VSCodeCheckbox
					checked={alwaysAllowReadOnlyOutsideWorkspace}
					onChange={(e: any) => setCachedStateField("alwaysAllowReadOnlyOutsideWorkspace", e.target.checked)}
					data-testid="always-allow-readonly-outside-workspace-checkbox">
					<span className="font-medium">{t("settings:autoApprove.readOnly.outsideWorkspace.label")}</span>
				</VSCodeCheckbox>
				<div className="text-vscode-descriptionForeground text-sm mt-1">
					{t("settings:autoApprove.readOnly.outsideWorkspace.description")}
				</div>
			</div>
			<div>
				<label className="block font-medium mb-1" data-testid="global-ignore-heading">
					{t("settings:autoApprove.readOnly.globalIgnore.label")}
				</label>
				<div className="text-vscode-descriptionForeground text-sm mt-1">
					{t("settings:autoApprove.readOnly.globalIgnore.description")}
				</div>
			</div>

			<div className="flex gap-2">
				<Input
					value={globalIgnoreInput}
					onChange={(e: any) => setGlobalIgnoreInput(e.target.value)}
					onKeyDown={(e: any) => {
						if (e.key === "Enter") {
							e.preventDefault()
							handleAddGlobalIgnorePattern()
						}
					}}
					placeholder={t("settings:autoApprove.readOnly.globalIgnore.patternPlaceholder")}
					className="grow"
					data-testid="global-ignore-input"
				/>
				<Button className="h-8" onClick={handleAddGlobalIgnorePattern} data-testid="add-global-ignore-button">
					{t("settings:autoApprove.readOnly.globalIgnore.addButton")}
				</Button>
			</div>

			<div className="flex flex-wrap gap-2">
				{(globallyIgnoredFiles ?? []).map((pattern, index) => (
					<Button
						key={index}
						variant="secondary"
						data-testid={`remove-global-ignore-${index}`}
						onClick={() => {
							const newPatterns = (globallyIgnoredFiles ?? []).filter((_, i) => i !== index)
							setCachedStateField("globallyIgnoredFiles", newPatterns)

							vscode.postMessage({
								type: "updateSettings",
								updatedSettings: { globallyIgnoredFiles: newPatterns },
							})
						}}>
						<div className="flex flex-row items-center gap-1">
							<div>{pattern}</div>
							<X className="text-foreground scale-75" />
						</div>
					</Button>
				))}
			</div>
		</div>
	)
}
