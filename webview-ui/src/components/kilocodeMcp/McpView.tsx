import { useState, useMemo } from "react"
import styled from "styled-components"
import { useAppTranslation } from "../../i18n/TranslationContext"

import { Server } from "lucide-react"
import { SectionHeader } from "../settings/SectionHeader"
import { Section } from "../settings/Section"

import RooMcpView from "../../components/mcp/McpView"
import { MarketplaceViewStateManager } from "../../components/marketplace/MarketplaceViewStateManager"
import { MarketplaceView } from "../../components/marketplace/MarketplaceView"

const McpView = () => {
	const [activeTab, setActiveTab] = useState("marketplace")
	const marketplaceStateManager = useMemo(() => new MarketplaceViewStateManager(), [])
	const { t } = useAppTranslation()

	const handleTabChange = (tab: string) => {
		setActiveTab(tab)
	}

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
						{activeTab === "marketplace" && (
							<MarketplaceView hideHeader targetTab="mcp" stateManager={marketplaceStateManager} />
						)}
						{activeTab === "installed" && <RooMcpView hideHeader onDone={() => {}} />}
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
