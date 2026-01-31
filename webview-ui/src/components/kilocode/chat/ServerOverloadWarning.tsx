import { ClineMessage } from "@roo-code/types"
import styled from "styled-components"
import { useTranslation } from "react-i18next"
import { AlertCircle } from "lucide-react"

type ServerOverloadWarningProps = {
    message: ClineMessage
    onUpgradeClick: () => void
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
	color: var(--vscode-foreground);
	font-size: 13px;
	line-height: 1.5;
`

const WarningContainer = styled.div`
	background-color: var(--vscode-editorWarning-background, rgba(255, 180, 0, 0.15));
	border: 1px solid var(--vscode-editorWarning-border, rgba(255, 180, 0, 0.3));
	border-radius: 4px;
	padding: 14px 16px;
	margin-top: 12px;
	display: flex;
	flex-direction: column;
	gap: 12px;
`

const UpgradeButton = styled.button`
	background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
	color: white;
	border: none;
	border-radius: 4px;
	padding: 10px 16px;
	font-weight: 500;
	font-size: 13px;
	cursor: pointer;
	transition: all 0.2s ease;
	width: 100%;

	&:hover {
		opacity: 0.9;
		box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
	}

	&:active {
		transform: scale(0.98);
	}
`

const IconContainer = styled.span`
	color: var(--vscode-editorWarning-foreground, #ff9800);
	display: flex;
	align-items: center;
	margin-bottom: -2px;
`

export const ServerOverloadWarning = ({ message, onUpgradeClick }: ServerOverloadWarningProps) => {
    const { t } = useTranslation()

    return (
        <>
            <HeaderContainer>
                <IconContainer>
                    <AlertCircle size={18} strokeWidth={2.5} />
                </IconContainer>
                <span style={{ fontWeight: "bold", fontSize: "14px" }}>
                    {t("kilocode:serverOverload.title", "Server Overloaded")}
                </span>
            </HeaderContainer>
            <Description>
                {message.text ||
                    t(
                        "kilocode:serverOverload.description",
                        "The server is currently experiencing high demand. Free users may experience delays. Upgrade to a paid plan for priority access.",
                    )}
            </Description>

            <WarningContainer>
                <div style={{ fontSize: "12px", color: "var(--vscode-descriptionForeground)" }}>
                    {t(
                        "kilocode:serverOverload.cta",
                        "Get priority access to faster inference and skip the queue.",
                    )}
                </div>
                <UpgradeButton onClick={onUpgradeClick}>
                    {t("kilocode:serverOverload.upgradeButton", "View Plans")}
                </UpgradeButton>
            </WarningContainer>
        </>
    )
}
