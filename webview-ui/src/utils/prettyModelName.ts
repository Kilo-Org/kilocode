export const prettyModelName = (modelId: string): string => {
	if (!modelId) {
		return ""
	}
	const [mainId, tag] = modelId.split(":")

	const projectName = mainId.includes("/") ? mainId.split("/")[0] : ""
	// Use slice(1).join("/") instead of split("/")[1] to preserve everything after the first slash
	// This handles model IDs with multiple slashes like "provider/org/model-name"
	const modelName = mainId.includes("/") ? mainId.split("/").slice(1).join("/") : mainId

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
