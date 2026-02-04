import { Image } from "../../components"

export const image = {
	render: Image,
	selfClosing: true,
	attributes: {
		src: {
			type: String,
			required: true,
			description: "The image source URL",
		},
		alt: {
			type: String,
			required: true,
			description: "Alternative text for the image",
		},
		width: {
			type: String,
			description: "Width of the image (e.g., '500px', '80%')",
		},
		height: {
			type: String,
			description: "Height of the image (e.g., '300px', 'auto')",
		},
		caption: {
			type: String,
			description: "Optional caption displayed below the image",
		},
	},
}
