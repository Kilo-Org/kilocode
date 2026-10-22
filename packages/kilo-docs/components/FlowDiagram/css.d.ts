declare module "*.css" {
  const content: Record<string, string>
  export default content
}

declare module "@xyflow/react/dist/style.css" {
  const content: string
  export default content
}
