import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { FreeModelsLink } from "../FreeModelsLink"
import { getModelIdKey, getSelectedModelId } from "../hooks/useSelectedModel"
import { useProviderModels } from "../hooks/useProviderModels"
import { safeJsonParse } from "@roo/safeJsonParse"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { isAlphaPeriodEndedError, isModelNotAllowedForTeamError } from "@roo/kilocode/errorUtils"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import i18next from "i18next"

type InnerMessage = {
	modelId?: string
	error?: {
		status?: number
		message?: string
	}
}

function warningText(innerMessage?: InnerMessage) {
	const unavailableModel = innerMessage?.modelId || "(unknown)"
	if (isAlphaPeriodEndedError(innerMessage?.error)) {
		return i18next.t("kilocode:invalidModel.alphaPeriodEnded", { model: unavailableModel })
	}
	if (isModelNotAllowedForTeamError(innerMessage?.error)) {
		return i18next.t("kilocode:invalidModel.notAllowedForTeam", { model: unavailableModel })
	}
	return i18next.t("kilocode:invalidModel.modelUnavailable", { model: unavailableModel })
}

export const InvalidModelWarning = ({ message, isLast }: { message: ClineMessage; isLast: boolean }) => {
	const { t } = useTranslation()
	const { currentApiConfigName, apiConfiguration } = useExtensionState()

	const {
		provider,
		providerModels,
		providerDefaultModel: defaultModelId,
		isLoading,
	} = useProviderModels(apiConfiguration)

	const [continueWasClicked, setWasContinueClicked] = useState(false)

	const selectedModelId = apiConfiguration
		? getSelectedModelId({
				provider,
				apiConfiguration,
				defaultModelId,
			})
		: defaultModelId

	const modelIdKey = getModelIdKey({ provider })

	const innerMessage = safeJsonParse<InnerMessage>(message.text)

	const didAlphaPeriodEnd = isAlphaPeriodEndedError(innerMessage?.error)

	const isAlreadyChanged = !!(
		selectedModelId === defaultModelId ||
		(innerMessage?.modelId && innerMessage.modelId !== selectedModelId)
	)

	const canChangeToDefaultModel =
		!isAlreadyChanged && !!apiConfiguration && !!currentApiConfigName && defaultModelId in providerModels

	return (
		<div className="bg-vscode-panel-border flex flex-col gap-3 p-3 text-base">
			<div>{warningText(innerMessage)}</div>
			{isLast && !isLoading && !continueWasClicked && (
				<>
					<VSCodeButton
						className="w-full"
						onClick={() => {
							setWasContinueClicked(true)
							if (canChangeToDefaultModel) {
								vscode.postMessage({
									type: "upsertApiConfiguration",
									text: currentApiConfigName,
									apiConfiguration: {
										...apiConfiguration,
										[modelIdKey]: defaultModelId,
									},
								})
							}
							vscode.postMessage({
								type: "askResponse",
								askResponse: "retry_clicked",
								text: message.text,
							})
						}}>
						{canChangeToDefaultModel
							? t("kilocode:invalidModel.continueWith", {
									model: providerModels[defaultModelId]?.displayName ?? defaultModelId,
								})
							: t("kilocode:invalidModel.continue")}
					</VSCodeButton>
					{didAlphaPeriodEnd && <FreeModelsLink className="w-full" origin="invalid_model" />}
				</>
			)}
		</div>
	)
}
