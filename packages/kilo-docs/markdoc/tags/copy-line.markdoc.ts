import { CopyLine } from "../../components"

export const copyLine = {
  render: CopyLine,
  selfClosing: true,
  attributes: {
    text: {
      type: String,
      required: true,
      description: "The exact one-line text to display and copy",
    },
  },
}
