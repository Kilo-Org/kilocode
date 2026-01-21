// kilocode_change - new file
import { useEffect, useState } from "react"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { Trash2 } from "lucide-react"

import { vscode } from "@/utils/vscode"
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@/components/ui"

interface SkillMetadata {
	name: string
	description: string
	path: string
	source: "global" | "project"
	mode?: string
}

const InstalledSkillsView = () => {
	const { t } = useTranslation()
	const [globalSkills, setGlobalSkills] = useState<SkillMetadata[]>([])
	const [projectSkills, setProjectSkills] = useState<SkillMetadata[]>([])
	const [skillToDelete, setSkillToDelete] = useState<SkillMetadata | null>(null)

	useEffect(() => {
		vscode.postMessage({ type: "refreshSkills" })
	}, [])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "skillsData") {
				setGlobalSkills(message.globalSkills || [])
				setProjectSkills(message.projectSkills || [])
			}
		}
		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleDelete = () => {
		if (skillToDelete) {
			vscode.postMessage({
				type: "deleteSkill",
				skillName: skillToDelete.name,
				source: skillToDelete.source,
				mode: skillToDelete.mode,
			})
			setSkillToDelete(null)
		}
	}

	return (
		<div className="px-5">
			{/* Description */}
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

			{/* Global Skills Section */}
			<div className="mb-3">
				<div className="text-sm font-normal mb-2">{t("kilocode:skills.sections.globalSkills")}</div>
				<SkillsList
					skills={globalSkills}
					onDelete={setSkillToDelete}
					emptyMessage={t("kilocode:skills.emptyState")}
				/>
			</div>

			{/* Project Skills Section */}
			<div style={{ marginBottom: -10 }}>
				<div className="text-sm font-normal mb-2">{t("kilocode:skills.sections.projectSkills")}</div>
				<SkillsList
					skills={projectSkills}
					onDelete={setSkillToDelete}
					emptyMessage={t("kilocode:skills.emptyState")}
				/>
			</div>

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
						<Button variant="destructive" onClick={handleDelete}>
							{t("kilocode:skills.deleteDialog.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

interface SkillsListProps {
	skills: SkillMetadata[]
	onDelete: (skill: SkillMetadata) => void
	emptyMessage: string
}

const SkillsList = ({ skills, onDelete, emptyMessage }: SkillsListProps) => {
	if (skills.length === 0) {
		return <div className="text-xs text-[var(--vscode-descriptionForeground)] py-2">{emptyMessage}</div>
	}

	return (
		<div className="flex flex-col gap-2">
			{skills.map((skill) => (
				<SkillRow
					key={`${skill.source}-${skill.mode || "generic"}-${skill.name}`}
					skill={skill}
					onDelete={onDelete}
				/>
			))}
		</div>
	)
}

interface SkillRowProps {
	skill: SkillMetadata
	onDelete: (skill: SkillMetadata) => void
}

const SkillRow = ({ skill, onDelete }: SkillRowProps) => {
	return (
		<div className="flex items-center p-2 bg-[var(--vscode-textCodeBlock-background)] rounded">
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{skill.name}</span>
					{skill.mode && (
						<span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)]">
							{skill.mode}
						</span>
					)}
				</div>
				<div className="text-xs text-[var(--vscode-descriptionForeground)] truncate">{skill.description}</div>
			</div>
			<Button variant="ghost" size="icon" onClick={() => onDelete(skill)} className="ml-2 flex-shrink-0">
				<Trash2 className="w-4 h-4" />
			</Button>
		</div>
	)
}

export default InstalledSkillsView
