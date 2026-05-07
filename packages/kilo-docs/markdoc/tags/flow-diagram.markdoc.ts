import { FlowDiagram } from "../../components"

export const flowDiagram = {
  render: FlowDiagram,
  selfClosing: true,
  attributes: {
    name: {
      type: String,
      required: true,
      description: "Name of the diagram to render (must match a key in diagrams/index.ts)",
    },
    height: {
      type: String,
      default: "400px",
      description: "Height of the diagram container",
    },
  },
}
