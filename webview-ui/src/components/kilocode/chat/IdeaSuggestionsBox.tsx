import { telemetryClient } from "@/utils/TelemetryClient"
import { vscode } from "@/utils/vscode"
import { TelemetryEventName } from "@roo-code/types"
import { useTranslation, Trans } from "react-i18next"

export const IdeaSuggestionsBox = () => {
	const { t } = useTranslation("kilocode")
	const ideas = Object.values(t("ideaSuggestionsBox.ideas", { returnObjects: true }))

	const handleClick = () => {
		const randomIndex = Math.floor(Math.random() * ideas.length)
		const randomIdea = ideas[randomIndex]

		vscode.postMessage({
			type: "insertTextToChatArea",
			text: randomIdea,
		})

		telemetryClient.capture(TelemetryEventName.SUGGESTION_BUTTON_CLICKED, {
			randomIdea,
		})
	}

	return (
		<div className="mt-4 p-3 bg-vscode-input-background rounded border border-vscode-panel-border">
			<p className="text-sm text-vscode-descriptionForeground font-bold">{t("ideaSuggestionsBox.newHere")}</p>
			<p className="text-sm text-vscode-descriptionForeground">
				<Trans
					i18nKey="kilocode:ideaSuggestionsBox.suggestionText"
					components={{
						suggestionButton: (
							<button
								onClick={handleClick}
								className="text-vscode-textLink-foreground hover:text-vscode-textLink-activeForeground cursor-pointer bg-transparent border-none p-0 font-sans"
							/>
						),
						sendIcon: <span className="codicon codicon-send inline-block align-middle" />,
					}}
				/>
			</p>
		</div>
	)
}
