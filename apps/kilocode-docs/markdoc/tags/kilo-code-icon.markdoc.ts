import { KiloCodeIcon } from "../../components"

export const kiloCodeIcon = {
	render: KiloCodeIcon,
	selfClosing: true,
	attributes: {
		size: {
			type: String,
			default: "1.2em",
			description: "Size of the icon (CSS height value)",
		},
	},
}
