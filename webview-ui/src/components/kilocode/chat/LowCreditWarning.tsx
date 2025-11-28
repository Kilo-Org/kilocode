import { ClineMessage, getAppUrl, TelemetryEventName } from "@roo-code/types"
import { vscode } from "@src/utils/vscode"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { RetryIconButton } from "../common/RetryIconButton"
import styled from "styled-components"
import { useTranslation } from "react-i18next"
import { VSCodeButtonLink } from "@/components/common/VSCodeButtonLink"
import { telemetryClient } from "@/utils/TelemetryClient"

type LowCreditWarningProps = {
	message: ClineMessage
	isOrganization: boolean
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

export const LowCreditWarning = ({ message, isOrganization }: LowCreditWarningProps) => {
	const { t } = useTranslation()
	let data = { title: "Error", message: "Payment required.", balance: "-?.??", buyCreditsUrl: "" }

	try {
		data = JSON.parse(message.text ?? "{}")
	} catch (e) {
		console.error("Failed to parse payment_required_prompt data:", e)
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
							vscode.postMessage({
								type: "askResponse",
								askResponse: "retry_clicked",
								text: message.text, // Pass original data back if needed
							})
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
				{!isOrganization && (
					<VSCodeButtonLink
						onClick={() => {
							telemetryClient.capture(TelemetryEventName.CREATE_ORGANIZATION_LINK_CLICKED, {
								origin: "low-credit-warning",
							})
						}}
						href={getAppUrl("/organizations/new")}
						appearance="primary"
						className="p-1 w-full rounded">
						{t("kilocode:lowCreditWarning.newOrganization")}
					</VSCodeButtonLink>
				)}
			</div>
		</>
	)
}
