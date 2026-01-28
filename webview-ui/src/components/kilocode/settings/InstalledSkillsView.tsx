// kilocode_change - new file
import { useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@src/components/ui"

interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "global" | "project"
	mode?: string
}

const InstalledSkillsView = () => {
	const { t } = useTranslation()
	const [skills, setSkills] = useState<SkillMetadata[]>([])
	const [skillToDelete, setSkillToDelete] = useState<SkillMetadata | null>(null)

	useEffect(() => {
		// Request skills data on mount
		vscode.postMessage({ type: "refreshSkills" })
	}, [])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "skillsData") {
				setSkills(message.skills ?? [])
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleDelete = (skill: SkillMetadata) => {
		setSkillToDelete(skill)
	}

	const confirmDelete = () => {
		if (!skillToDelete) return

		vscode.postMessage({
			type: "removeInstalledMarketplaceItem",
			mpItem: {
				type: "skill",
				id: skillToDelete.name,
				name: skillToDelete.name,
				description: skillToDelete.description,
				category: "",
				githubUrl: "",
				content: "",
				displayName: skillToDelete.name,
				displayCategory: "",
			},
			mpInstallOptions: { target: skillToDelete.source },
		})
		setSkillToDelete(null)
	}

	const globalSkills = skills.filter((s) => s.source === "global")
	const projectSkills = skills.filter((s) => s.source === "project")

	return (
		<div className="px-5">
			<div className="text-xs text-[var(--vscode-descriptionForeground)] mb-4">
				<p>
					{t("kilocode:skills.description")}{" "}
					<VSCodeLink
						href="https://kilo.ai/docs/features/skills"
						style={{ display: "inline" }}
						className="text-xs">
						{t("kilocode:docs")}
					</VSCodeLink>
				</p>
			</div>

			{skills.length === 0 ? (
				<div className="text-sm text-[var(--vscode-descriptionForeground)] py-4">
					{t("kilocode:skills.noSkills")}
				</div>
			) : (
				<>
					{/* Project Skills */}
					{projectSkills.length > 0 && (
						<SkillsSection
							title={t("kilocode:skills.projectSkills")}
							skills={projectSkills}
							onDelete={handleDelete}
						/>
					)}

					{/* Global Skills */}
					{globalSkills.length > 0 && (
						<SkillsSection
							title={t("kilocode:skills.globalSkills")}
							skills={globalSkills}
							onDelete={handleDelete}
						/>
					)}
				</>
			)}

			{/* Delete Confirmation Dialog */}
			<Dialog open={!!skillToDelete} onOpenChange={(open) => !open && setSkillToDelete(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("kilocode:skills.deleteDialog.title")}</DialogTitle>
						<DialogDescription>
							{t("kilocode:skills.deleteDialog.description", { skillName: skillToDelete?.name })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setSkillToDelete(null)}>
							{t("kilocode:skills.deleteDialog.cancel")}
						</Button>
						<Button variant="primary" onClick={confirmDelete}>
							{t("kilocode:skills.deleteDialog.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

interface SkillsSectionProps {
	title: string
	skills: SkillMetadata[]
	onDelete: (skill: SkillMetadata) => void
}

const SkillsSection = ({ title, skills, onDelete }: SkillsSectionProps) => {
	return (
		<div className="mb-4">
			<h4 className="text-sm font-medium text-[var(--vscode-foreground)] mb-2">{title}</h4>
			<div className="flex flex-col gap-2">
				{skills.map((skill) => (
					<SkillRow key={`${skill.source}-${skill.name}`} skill={skill} onDelete={onDelete} />
				))}
			</div>
		</div>
	)
}

interface SkillRowProps {
	skill: SkillMetadata
	onDelete: (skill: SkillMetadata) => void
}

const SkillRow = ({ skill, onDelete }: SkillRowProps) => {
	return (
		<div
			className="flex items-center justify-between p-2 rounded"
			style={{ background: "var(--vscode-textCodeBlock-background)" }}>
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-[var(--vscode-foreground)]">{skill.name}</span>
					{skill.mode && (
						<span
							className="text-xs px-1.5 py-0.5 rounded"
							style={{
								background: "var(--vscode-badge-background)",
								color: "var(--vscode-badge-foreground)",
							}}>
							{skill.mode}
						</span>
					)}
				</div>
				<div className="text-xs text-[var(--vscode-descriptionForeground)] truncate">{skill.description}</div>
			</div>
			<Button variant="ghost" size="icon" onClick={() => onDelete(skill)} style={{ marginLeft: "8px" }}>
				<span className="codicon codicon-trash" style={{ fontSize: "14px" }}></span>
			</Button>
		</div>
	)
}

export default InstalledSkillsView
