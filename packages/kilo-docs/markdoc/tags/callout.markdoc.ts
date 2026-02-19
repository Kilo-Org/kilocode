import { Callout } from "../../components"

export const callout = {
	render: Callout,
	children: ["paragraph", "tag", "list"],
	attributes: {
		title: {
			type: String,
			description: "Optional custom title for the callout",
		},
		type: {
			type: String,
			default: "note",
			matches: ["generic", "note", "tip", "info", "warning", "danger"],
			description: "The type of callout: generic (no icon/title), note, tip, info, warning, or danger",
		},
		collapsed: {
			type: Boolean,
			default: false,
			description: "When true, the callout starts collapsed and can be expanded by clicking the header",
		},
	},
}
