import { memo, useState } from "react"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import styled from "styled-components"
import { Trans } from "react-i18next"

import { TelemetrySetting } from "@roo/TelemetrySetting"

import { vscode } from "@src/utils/vscode"
import { useAppTranslation } from "@src/i18n/TranslationContext"

const BannerContainer = styled.div`
	border: 1px solid var(--vscode-checkbox-border); // kilocode_change
	background-color: var(--vscode-editorSuggestWidget-background); // kilocode_change
	padding: 12px 20px;
	display: flex;
	flex-direction: column;
	gap: 10px;
	flex-shrink: 0;
	margin-bottom: 6px;
`

const ButtonContainer = styled.div`
	display: flex;
	gap: 8px;
	width: 100%;
	& > vscode-button {
		flex: 1;
	}
`

const TelemetryBanner = () => {
	const { t } = useAppTranslation()
	const [hasChosen, setHasChosen] = useState(false)

	const handleAllow = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "enabled" satisfies TelemetrySetting })
	}

	const handleDeny = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "disabled" satisfies TelemetrySetting })
	}

	const handleOpenSettings = () => {
		window.postMessage({
			type: "action",
			action: "settingsButtonClicked",
			values: { section: "about" }, // Link directly to about settings with telemetry controls
		})
	}

	return (
		<BannerContainer>
			<div>
				<strong>{t("welcome:telemetry.title")}</strong>
				<div className="mt-1">
					<Trans
						i18nKey="welcome:telemetry.anonymousTelemetry"
						components={{
							privacyLink: <VSCodeLink href="https://kilocode.ai/privacy" />,
						}}
					/>
					<div className="mt-1">
						<Trans
							i18nKey="welcome:telemetry.changeSettings"
							components={{
								settingsLink: <VSCodeLink href="#" onClick={handleOpenSettings} />,
							}}
						/>
						.
					</div>
				</div>
			</div>
			<ButtonContainer>
				<VSCodeButton appearance="primary" onClick={handleAllow} disabled={hasChosen}>
					{t("welcome:telemetry.allow")}
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleDeny} disabled={hasChosen}>
					{t("welcome:telemetry.deny")}
				</VSCodeButton>
			</ButtonContainer>
		</BannerContainer>
	)
}

export default memo(TelemetryBanner)
