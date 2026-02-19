import { Icon } from "../../components"

export const icon = {
	render: Icon,
	selfClosing: true,
	attributes: {
		src: {
			type: String,
			required: true,
		},
		srcDark: {
			type: String,
			description: "Optional image source for dark mode. Falls back to src if not provided.",
		},
		alt: {
			type: String,
			default: "icon",
		},
		size: {
			type: String,
			default: "1.2em",
		},
	},
}
