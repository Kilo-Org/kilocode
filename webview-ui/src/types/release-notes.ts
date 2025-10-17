export interface ReleaseItem {
	description: string
	prNumber?: number
	commitHash?: string
	author?: string
	category: ReleaseItemCategory
	details?: string
}

export type ReleaseItemCategory = "feature" | "fix" | "improvement" | "breaking" | "other"

export interface ReleaseNote {
	version: string
	date?: string
	features: ReleaseItem[]
	fixes: ReleaseItem[]
	improvements: ReleaseItem[]
	breakingChanges: ReleaseItem[]
	rawChanges: ReleaseItem[]
}
