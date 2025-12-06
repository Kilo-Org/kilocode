import { useMemo } from "react"

export const useIntelligentProviderValidation = (profiles: any[]) => {
	return useMemo(() => {
		const difficultyLevels = profiles.map((p) => p.difficultyLevel)
		const hasEasy = difficultyLevels.includes("easy")
		const hasMedium = difficultyLevels.includes("medium")
		const hasHard = difficultyLevels.includes("hard")

		if (!hasEasy || !hasMedium || !hasHard) {
			const missing = []
			if (!hasEasy) missing.push("Easy")
			if (!hasMedium) missing.push("Medium")
			if (!hasHard) missing.push("Hard")
			return `Required profiles missing: ${missing.join(", ")}. Please configure all three difficulty profiles before saving.`
		}
		return null
	}, [profiles])
}
