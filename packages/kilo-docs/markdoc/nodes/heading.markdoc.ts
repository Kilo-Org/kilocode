import { Tag } from "@markdoc/markdoc"

import { Heading } from "../../components"

function text(child) {
  if (typeof child === "string") return child
  if (Tag.isTag(child)) return child.children.map(text).join(" ")
  return ""
}

function generateID(children, attributes) {
  if (attributes.id && typeof attributes.id === "string") {
    return attributes.id
  }
  return children
    .map(text)
    .join(" ")
    .replace(/[?/]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
}

export const heading = {
  render: Heading,
  children: ["inline"],
  attributes: {
    id: { type: String },
    level: { type: Number, required: true, default: 1 },
    className: { type: String },
  },
  transform(node, config) {
    const attributes = node.transformAttributes(config)
    const children = node.transformChildren(config)
    const id = generateID(children, attributes)

    return new Tag(this.render, { ...attributes, id }, children)
  },
}
