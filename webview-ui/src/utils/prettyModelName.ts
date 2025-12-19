// Hardcoded credits information for Axon models
const AXON_MODEL_CREDITS: Record<string, string> = {
	"axon-mini": "(0.5x)",
	"axon-code": "(1x)",
	// "axon-code-exp": "(1x)",
	// "gemini-3-flash-preview": "(1x)",
	// "gemini-3-pro-preview": "(2x)",
}

export const prettyModelName = (modelId: string): string => {
	if (!modelId) {
		return ""
	}
	const [mainId, tag] = modelId.split(":")

	const projectName = mainId.includes("/") ? mainId.split("/")[0] : ""
	const modelName = mainId.includes("/") ? mainId.split("/")[1] : mainId

	// Capitalize each word and join with spaces
	const formattedProject = projectName ? projectName.charAt(0).toUpperCase() + projectName.slice(1) : ""

	const formattedName = modelName
		.split("-")
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")

	const formattedTag = tag ? `(${tag.charAt(0).toUpperCase() + tag.slice(1)})` : ""

	return [[formattedProject, formattedName].filter(Boolean).join(" / "), formattedTag].join(" ")
}

// Function to get credits for Axon models
export const getModelCredits = (modelId: string): string | null => {
	return AXON_MODEL_CREDITS[modelId]
}
