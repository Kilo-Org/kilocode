import { devilcodeIcon } from "../../components"

export const devilcodeIcon = {
  render: devilcodeIcon,
  selfClosing: true,
  attributes: {
    size: {
      type: String,
      default: "1.2em",
      description: "Size of the icon (CSS height value)",
    },
  },
}
