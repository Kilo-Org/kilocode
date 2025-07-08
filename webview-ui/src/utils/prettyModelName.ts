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
