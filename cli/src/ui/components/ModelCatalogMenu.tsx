/**
 * ModelCatalogMenu component - displays interactive model catalog
 */

import React from "react"
import { Box, Text } from "ink"
import { useAtomValue } from "jotai"
import {
	modelCatalogVisibleAtom,
	modelCatalogSearchAtom,
	modelCatalogSortAtom,
	modelCatalogCapabilitiesAtom,
	modelCatalogProviderFilterAtom,
	modelCatalogPageAtom,
	modelCatalogVisibleItemsAtom,
	modelCatalogSelectedIndexAtom,
	modelCatalogPageCountAtom,
	modelCatalogAllModelsAtom,
} from "../../state/atoms/modelSelection.js"
import { useTheme } from "../../state/hooks/useTheme.js"
import { prettyModelName } from "../../constants/providers/models.js"
import type { ModelCatalogItem } from "../../types/modelCatalog.js"

const SORT_LABELS: Record<string, string> = {
	preferred: "Preferred",
	name: "Name",
	context: "Ctx",
	price: "Price",
}

const FILTER_LABELS: Record<string, string> = {
	images: "Images",
	cache: "Cache",
	reasoning: "Reasoning",
	free: "Free",
}

export const ModelCatalogMenu: React.FC = () => {
	const theme = useTheme()
	const visible = useAtomValue(modelCatalogVisibleAtom)
	const search = useAtomValue(modelCatalogSearchAtom)
	const sort = useAtomValue(modelCatalogSortAtom)
	const capabilities = useAtomValue(modelCatalogCapabilitiesAtom)
	const providerFilter = useAtomValue(modelCatalogProviderFilterAtom)
	const page = useAtomValue(modelCatalogPageAtom)
	const visibleItems = useAtomValue(modelCatalogVisibleItemsAtom)
	const selectedIndex = useAtomValue(modelCatalogSelectedIndexAtom)
	const pageCount = useAtomValue(modelCatalogPageCountAtom)
	const allModels = useAtomValue(modelCatalogAllModelsAtom)

	if (!visible) {
		return null
	}

	const providers = allModels ? Object.keys(allModels) : []
	const currentProviderName = providerFilter ?? "all"

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.ui.border.active} paddingX={1}>
			<Text bold color={theme.semantic.info}>
				Model Catalog
			</Text>

			<Box flexDirection="column" marginTop={1}>
				<Box>
					<Text color={theme.ui.text.dimmed}>Provider: </Text>
					<Text bold>{currentProviderName}</Text>
					<Text color={theme.ui.text.dimmed}> ({providers.length} providers)</Text>
				</Box>

				<Box>
					<Text color={theme.ui.text.dimmed}>Search: </Text>
					<Text>{search || "(start typing to search)"}</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Box>
					<Text color={theme.ui.text.dimmed}>Sort: </Text>
					{Object.entries(SORT_LABELS).map(([key, label]) => (
						<Text
							key={key}
							color={sort === key ? theme.semantic.info : theme.ui.text.dimmed}
							bold={sort === key}>
							{sort === key ? `[${label}]` : label}{" "}
						</Text>
					))}
				</Box>
				<Box>
					<Text color={theme.ui.text.dimmed}>Filter: </Text>
					{Object.entries(FILTER_LABELS).map(([key, icon]) => (
						<Text
							key={key}
							color={
								capabilities.includes(key as "images" | "cache" | "reasoning" | "free")
									? theme.semantic.info
									: theme.ui.text.dimmed
							}
							bold={capabilities.includes(key as "images" | "cache" | "reasoning" | "free")}>
							{capabilities.includes(key as "images" | "cache" | "reasoning" | "free")
								? `[${icon}]`
								: icon}{" "}
						</Text>
					))}
				</Box>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed}>━</Text>
			</Box>

			{visibleItems.length === 0 ? (
				<Box paddingY={1}>
					<Text color={theme.ui.text.dimmed}>No models found</Text>
				</Box>
			) : (
				<ModelList items={visibleItems} selectedIndex={selectedIndex} />
			)}

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed}>━</Text>
			</Box>

			<Box flexDirection="row" justifyContent="space-between" marginTop={1}>
				<Text color={theme.ui.text.dimmed}>
					Page {page + 1}/{pageCount || 1}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={theme.ui.text.dimmed} dimColor>
					↑↓ Navigate • Type to search • s Sort • f Filter • p Provider • Enter Select • Esc Exit
				</Text>
			</Box>
		</Box>
	)
}

interface ModelListProps {
	items: ModelCatalogItem[]
	selectedIndex: number
}

const ModelList: React.FC<ModelListProps> = ({ items, selectedIndex }) => {
	const theme = useTheme()

	let currentProvider: string | null = null
	const displayItems: Array<
		{ type: "provider"; provider: string } | { type: "model"; modelItem: ModelCatalogItem; index: number }
	> = []

	for (let i = 0; i < items.length; i++) {
		const item = items[i]
		if (!item) continue
		if (item.provider !== currentProvider) {
			currentProvider = item.provider
			displayItems.push({ type: "provider", provider: item.provider })
		}
		displayItems.push({ type: "model", modelItem: item, index: i })
	}

	return (
		<Box flexDirection="column">
			{displayItems.map((displayItem) => {
				if (displayItem.type === "provider") {
					return (
						<Box key={`provider-${displayItem.provider}`} marginTop={1}>
							<Text color={theme.ui.text.primary} bold>
								{displayItem.provider}:
							</Text>
						</Box>
					)
				}

				const item = displayItem.modelItem
				const isSelected = displayItem.index === selectedIndex
				const displayName = item.model.displayName || prettyModelName(item.modelId)

				return (
					<Box key={`${item.provider}-${item.modelId}`}>
						{isSelected ? (
							<Text color={theme.semantic.success} bold>
								&gt;{" "}
							</Text>
						) : (
							<Text> </Text>
						)}

						<Text color={isSelected ? theme.semantic.success : theme.ui.text.primary} bold={isSelected}>
							{displayName}
						</Text>

						{item.isCurrent && <Text color={theme.semantic.info}> (current)</Text>}

						<Text color={theme.ui.text.dimmed}>
							{" "}
							({Math.floor((item.model.contextWindow || 0) / 1000)}K ctx)
						</Text>

						{item.model.supportsImages && <Text color={theme.ui.text.dimmed}> [Images]</Text>}
						{item.model.supportsPromptCache && <Text color={theme.ui.text.dimmed}> [Cache]</Text>}
						{item.model.supportsReasoningEffort && <Text color={theme.ui.text.dimmed}> [Reasoning]</Text>}
						{item.model.isFree && <Text color={theme.semantic.success}> [Free]</Text>}
					</Box>
				)
			})}
		</Box>
	)
}
