import { BrowserFrame } from "../../components"

export const browserFrame = {
  render: BrowserFrame,
  children: ["paragraph", "tag", "list"],
  attributes: {
    url: {
      type: String,
      description: "Optional URL to display in the address bar",
    },
    caption: {
      type: String,
      description: "Optional caption below the frame",
    },
  },
}
