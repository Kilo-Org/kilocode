import { useRef, useState, useEffect } from "react"
import { useWindowSize } from "react-use"
import { useTranslation } from "react-i18next"
import styled from "styled-components"

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip"
import BottomButton from "../BottomButton"

import KiloRulesWorkflowsView from "./KiloRulesWorkflowsView"
import ModesView from "@src/components/modes/ModesView"
import McpView from "@src/components/mcp/McpView"
import InstalledSkillsView from "@src/components/kilocode/settings/InstalledSkillsView"

const KiloRulesToggleModal: React.FC = () => {
	const { t } = useTranslation()
	// kilocode_change - tooltip now reflects Agent Behaviour scope
	const agentBehaviourTypes = [
		t("kilocode:rules.agentBehaviourTypes.rules"),
		t("kilocode:rules.agentBehaviourTypes.workflows"),
		t("kilocode:rules.agentBehaviourTypes.mcps"),
		t("kilocode:rules.agentBehaviourTypes.modes"),
		t("kilocode:rules.agentBehaviourTypes.skills"),
	].join(", ")

	const [isVisible, setIsVisible] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const modalRef = useRef<HTMLDivElement>(null)
	const { width: viewportWidth, height: viewportHeight } = useWindowSize()
	const [arrowPosition, setArrowPosition] = useState(0)
	const [menuPosition, setMenuPosition] = useState(0)
	const [currentView, setCurrentView] = useState<"modes" | "mcp" | "rule" | "workflow" | "skills">("rule")

	useEffect(() => {
		const handler = (event: MouseEvent | TouchEvent) => {
			const target = event.target as HTMLElement
			if (modalRef.current?.contains(target)) return
			// Ignore clicks on Radix portaled content (Select/Popover dropdowns)
			if (target.closest("[data-radix-popper-content-wrapper]")) return
			setIsVisible(false)
		}
		document.addEventListener("mousedown", handler)
		document.addEventListener("touchstart", handler)
		return () => {
			document.removeEventListener("mousedown", handler)
			document.removeEventListener("touchstart", handler)
		}
	}, [])

	useEffect(() => {
		if (isVisible && buttonRef.current) {
			const buttonRect = buttonRef.current.getBoundingClientRect()
			const buttonCenter = buttonRect.left + buttonRect.width / 2
			const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

			setArrowPosition(rightPosition)
			setMenuPosition(buttonRect.top + 1)
		}
	}, [isVisible, viewportWidth, viewportHeight])

	return (
		<div ref={modalRef}>
			<div ref={buttonRef} className="inline-flex min-w-0 max-w-full">
				<TooltipProvider>
					<Tooltip open={isVisible ? false : undefined}>
						<TooltipTrigger asChild>
							<BottomButton
								iconClass="codicon-law"
								ariaLabel={t("kilocode:rules.ariaLabel")}
								onClick={() => setIsVisible(!isVisible)}
							/>
						</TooltipTrigger>
						<TooltipContent>{t("kilocode:rules.tooltip", { types: agentBehaviourTypes })}</TooltipContent>
					</Tooltip>
				</TooltipProvider>
			</div>

			{isVisible && (
				<div
					className="fixed left-[15px] right-[15px] border border-[var(--vscode-editorGroup-border)] p-3 rounded z-[1000]"
					style={{
						bottom: `calc(100vh - ${menuPosition}px + 6px)`,
						background: "var(--vscode-editor-background)",
						// Keep the modal a consistent height to avoid “jumpy” resizing between tabs.
						height: "min(520px, calc(100vh - 100px))",
						overflow: "hidden",
						display: "flex",
						flexDirection: "column",
					}}>
					<div
						className="fixed w-[10px] h-[10px] z-[-1] rotate-45 border-r border-b border-[var(--vscode-editorGroup-border)]"
						style={{
							bottom: `calc(100vh - ${menuPosition}px)`,
							right: arrowPosition,
							background: "var(--vscode-editor-background)",
						}}
					/>

					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							marginBottom: "10px",
						}}>
						<div
							style={{
								display: "flex",
								gap: "1px",
								borderBottom: "1px solid var(--vscode-panel-border)",
							}}>
							<StyledTabButton
								$isActive={currentView === "modes"}
								onClick={() => setCurrentView("modes")}>
								{t("settings:sections.modes")}
							</StyledTabButton>
							<StyledTabButton $isActive={currentView === "mcp"} onClick={() => setCurrentView("mcp")}>
								{t("kilocode:settings.sections.mcp")}
							</StyledTabButton>
							<StyledTabButton $isActive={currentView === "rule"} onClick={() => setCurrentView("rule")}>
								{t("kilocode:rules.tabs.rules")}
							</StyledTabButton>
							<StyledTabButton
								$isActive={currentView === "workflow"}
								onClick={() => setCurrentView("workflow")}>
								{t("kilocode:rules.tabs.workflows")}
							</StyledTabButton>
							<StyledTabButton
								$isActive={currentView === "skills"}
								onClick={() => setCurrentView("skills")}>
								{t("kilocode:settings.sections.skills")}
							</StyledTabButton>
						</div>
					</div>

					<div
						data-testid="kilo-rules-toggle-modal-content"
						style={{
							flex: 1,
							overflowY: "auto",
							overflowX: "hidden",
							overscrollBehavior: "contain",
						}}>
						{currentView === "modes" && <ModesView hideHeader />}
						{currentView === "mcp" && <McpView hideHeader onDone={() => {}} />}
						{currentView === "rule" && <KiloRulesWorkflowsView type="rule" />}
						{currentView === "workflow" && <KiloRulesWorkflowsView type="workflow" />}
						{currentView === "skills" && <InstalledSkillsView />}
					</div>
				</div>
			)}
		</div>
	)
}

const StyledTabButton = styled.button<{ $isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.$isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.$isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	margin-bottom: -1px;
	font-family: inherit;

	&:hover {
		color: var(--vscode-foreground);
	}
`

export default KiloRulesToggleModal
