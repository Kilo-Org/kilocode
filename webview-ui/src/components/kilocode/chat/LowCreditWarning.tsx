import { ClineMessage } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { RetryIconButton } from "../common/RetryIconButton"
import styled from "styled-components"
import { useTranslation } from "react-i18next"
import { FreeModelsLink } from "../FreeModelsLink"
import { useExtensionState } from "@src/context/ExtensionStateContext"

type LowCreditWarningProps = {
	message: ClineMessage
}

type LowCreditWarningData = {
	title: string
	message: string
	balance: string
	buyCreditsUrl: string
	defaultFreeModel?: string
}

const HeaderContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 10px;
`

const Description = styled.div`
	margin: 0;
	white-space: pre-wrap;
	word-break: break-word;
	overflow-wrap: anywhere;
`

export const LowCreditWarning = ({ message }: LowCreditWarningProps) => {
	const { t } = useTranslation()
	const { currentApiConfigName, apiConfiguration } = useExtensionState()
	let data: LowCreditWarningData = {
		title: "Error",
		message: "Payment required.",
		balance: "-?.??",
		buyCreditsUrl: "",
	}

	try {
		data = JSON.parse(message.text ?? "{}")
	} catch (e) {
		console.error("Failed to parse payment_required_prompt data:", e)
	}

	const handleRetry = () => {
		vscode.postMessage({
			type: "askResponse",
			askResponse: "retry_clicked",
			text: message.text,
		})
	}

	const handleSwitchToFreeModel = () => {
		if (!data.defaultFreeModel || !currentApiConfigName || !apiConfiguration) {
			return
		}
		vscode.postMessage({
			type: "upsertApiConfiguration",
			text: currentApiConfigName,
			apiConfiguration: {
				...apiConfiguration,
				kilocodeModel: data.defaultFreeModel,
			},
		})
		setTimeout(() => handleRetry(), 500)
	}

	return (
		<>
			<HeaderContainer>
				<span className="text-blue-400" style={{ marginBottom: "-1.5px" }}>
					$
				</span>
				<span style={{ fontWeight: "bold" }}>{data.title}</span>
			</HeaderContainer>
			<Description>{data.message}</Description>

			<div
				className="bg-vscode-panel-border flex flex-col gap-3"
				style={{
					borderRadius: "4px",
					display: "flex",
					marginTop: "15px",
					padding: "14px 16px 22px",
					justifyContent: "center",
				}}>
				<div className="flex justify-between items-center">
					{t("kilocode:lowCreditWarning.lowBalance")}
					<RetryIconButton
						onClick={() => {
							handleRetry()
						}}
					/>
				</div>
				<VSCodeButton
					className="p-1 w-full rounded"
					onClick={(e) => {
						e.preventDefault()

						vscode.postMessage({
							type: "openInBrowser",
							url: data.buyCreditsUrl,
						})
					}}>
					{t("kilocode:lowCreditWarning.addCredit")}
				</VSCodeButton>
				{apiConfiguration?.kilocodeModel !== data.defaultFreeModel &&
					(data.defaultFreeModel ? (
						<VSCodeButton
							className="p-1 w-full rounded mt-1"
							appearance="primary"
							onClick={handleSwitchToFreeModel}>
							{t("kilocode:lowCreditWarning.switchToFreeModel")}
						</VSCodeButton>
					) : (
						<FreeModelsLink className="p-1 w-full rounded mt-1" origin="chat" />
					))}
			</div>
		</>
	)
}
