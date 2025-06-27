// kilocode_change: imported from Cline and adjusted with our own changes

import { useEffect, useState } from "react"
import styled from "styled-components"
import { vscode } from "../../utils/vscode"
import McpMarketplaceView from "./marketplace/McpMarketplaceView"
import { useAppTranslation } from "../../i18n/TranslationContext"

import { Server } from "lucide-react"
import { SectionHeader } from "../settings/SectionHeader"
import { Section } from "../settings/Section"

import RooMcpView from "../../components/mcp/McpView"

const McpView = () => {
	const [activeTab, setActiveTab] = useState("marketplace")
	const { t } = useAppTranslation()

	const handleTabChange = (tab: string) => {
		setActiveTab(tab)
	}

	useEffect(() => {
		vscode.postMessage({ type: "silentlyRefreshMcpMarketplace" })
		vscode.postMessage({ type: "fetchLatestMcpServersFromHub" })
	}, [])

	return (
		<div
			style={{
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
			}}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<Server className="w-4" />
					<div>{t("kilocode:settings.sections.mcp")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div style={{ flex: 1, overflow: "auto" }}>
					{/* Tabs container */}
					<div
						style={{
							display: "flex",
							gap: "1px",
							padding: "0 20px 0 20px",
							borderBottom: "1px solid var(--vscode-panel-border)",
						}}>
						<TabButton
							isActive={activeTab === "marketplace"}
							onClick={() => handleTabChange("marketplace")}>
							Marketplace
						</TabButton>

						<TabButton isActive={activeTab === "installed"} onClick={() => handleTabChange("installed")}>
							Installed
						</TabButton>
					</div>

					{/* Content container */}
					<div style={{ width: "100%" }}>
						{activeTab === "marketplace" && <McpMarketplaceView />}
						{activeTab === "installed" && <RooMcpView />}
					</div>
				</div>
			</Section>
		</div>
	)
}

const StyledTabButton = styled.button<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export const TabButton = ({
	children,
	isActive,
	onClick,
}: {
	children: React.ReactNode
	isActive: boolean
	onClick: () => void
}) => (
	<StyledTabButton isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

export default McpView
