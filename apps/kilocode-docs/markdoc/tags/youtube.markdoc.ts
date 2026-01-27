import { YouTube } from "../../components"

export const youtube = {
	render: YouTube,
	selfClosing: true,
	attributes: {
		url: {
			type: String,
			required: true,
			description: "The YouTube video URL",
		},
		title: {
			type: String,
			description: "Accessible title for the video iframe",
		},
		caption: {
			type: String,
			description: "Optional caption to display below the video",
		},
	},
}
