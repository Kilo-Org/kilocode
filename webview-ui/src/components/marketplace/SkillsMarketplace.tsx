// kilocode_change new file

import React, { useMemo, useState } from "react"
import { SkillMarketplaceItem } from "@roo-code/types"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SkillItemCard } from "./components/SkillItemCard"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"

interface SkillsMarketplaceProps {
	skills: SkillMarketplaceItem[]
	isLoading: boolean
}

export const SkillsMarketplace: React.FC<SkillsMarketplaceProps> = ({ skills, isLoading }) => {
	const { t } = useAppTranslation()
	const { marketplaceInstalledMetadata } = useExtensionState()
	const [searchQuery, setSearchQuery] = useState("")
	const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

	// Get unique categories from skills with their display names
	const categoryMap = useMemo(() => {
		const map = new Map<string, string>()
		skills.forEach((skill) => {
			if (!map.has(skill.category)) {
				map.set(skill.category, skill.displayCategory)
			}
		})
		return map
	}, [skills])

	// Get sorted category keys
	const categories = useMemo(() => {
		return Array.from(categoryMap.keys()).sort()
	}, [categoryMap])

	// Filter skills based on search query and selected category
	const filteredSkills = useMemo(() => {
		return skills.filter((skill) => {
			const matchesSearch =
				searchQuery === "" ||
				skill.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
				skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
				skill.category.toLowerCase().includes(searchQuery.toLowerCase())

			const matchesCategory = selectedCategory === null || skill.category === selectedCategory

			return matchesSearch && matchesCategory
		})
	}, [skills, searchQuery, selectedCategory])

	if (isLoading) {
		return (
			<div className="flex items-center justify-center p-8">
				<div className="text-vscode-descriptionForeground">{t("marketplace:skills.loading")}</div>
			</div>
		)
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Search and filter controls */}
			<div className="flex flex-col gap-2">
				<Input
					type="text"
					placeholder={t("marketplace:skills.searchPlaceholder")}
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="w-full"
				/>

				{/* Category filter buttons */}
				{categories.length > 0 && (
					<div className="flex flex-wrap gap-1">
						<Button
							size="sm"
							variant={selectedCategory === null ? "primary" : "secondary"}
							className={cn("text-xs h-6 py-0 px-2")}
							onClick={() => setSelectedCategory(null)}>
							{t("marketplace:skills.allCategories")}
						</Button>
						{categories.map((category) => (
							<Button
								key={category}
								size="sm"
								variant={selectedCategory === category ? "primary" : "secondary"}
								className={cn("text-xs h-6 py-0 px-2")}
								onClick={() => setSelectedCategory(selectedCategory === category ? null : category)}>
								{categoryMap.get(category)}
							</Button>
						))}
					</div>
				)}
			</div>

			{/* Results count */}
			<div className="text-sm text-vscode-descriptionForeground">
				{t("marketplace:skills.resultsCount", { count: filteredSkills.length })}
			</div>

			{/* Skills list */}
			{filteredSkills.length === 0 ? (
				<div className="flex items-center justify-center p-8">
					<div className="text-vscode-descriptionForeground">{t("marketplace:skills.noResults")}</div>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					{filteredSkills.map((skill) => (
						<SkillItemCard
							key={skill.id}
							skill={skill}
							installed={{
								project: marketplaceInstalledMetadata?.project?.[skill.id],
								global: marketplaceInstalledMetadata?.global?.[skill.id],
							}}
						/>
					))}
				</div>
			)}
		</div>
	)
}
