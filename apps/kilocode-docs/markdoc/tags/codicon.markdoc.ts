import { Codicon } from "../../components"

export const codicon = {
	render: Codicon,
	selfClosing: true,
	attributes: {
		name: {
			type: String,
			required: true,
			description: "The name of the VS Code codicon (e.g., 'send', 'check', 'warning')",
		},
		size: {
			type: String,
			default: "1em",
			description: "The size of the icon (CSS font-size value)",
		},
		className: {
			type: String,
			default: "",
			description: "Additional CSS classes to apply to the icon",
		},
	},
}
