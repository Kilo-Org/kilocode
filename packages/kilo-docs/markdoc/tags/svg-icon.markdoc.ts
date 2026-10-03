import { SvgIcon } from "../../components"

export const svgIcon = {
  render: SvgIcon,
  selfClosing: true,
  attributes: {
    src: {
      type: String,
      required: true,
      description: "Path to the inline SVG (e.g., '/docs/img/desktop/code.svg')",
    },
    size: {
      type: String,
      default: "1em",
      description: "Icon size (CSS width/height value)",
    },
    label: {
      type: String,
      description: "Accessible label; omit for decorative icons that sit next to their text",
    },
  },
}
