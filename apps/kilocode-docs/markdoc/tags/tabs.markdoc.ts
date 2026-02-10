import { Tabs, Tab } from "../../components"

export const tabs = {
	render: Tabs,
	children: ["tab"],
	attributes: {},
}

export const tab = {
	render: Tab,
	children: ["paragraph", "tag", "list", "fence", "heading"],
	attributes: {
		label: {
			type: String,
			required: true,
			description: "The label shown on the tab button",
		},
	},
}
