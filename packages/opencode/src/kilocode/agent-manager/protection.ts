export function assertMutablePath(filepath: string) {
  const parts = filepath.split(/[\\/]/)
  const file = parts.at(-1)
  const dir = parts.at(-2)
  if (file !== "agent-manager.json" || ![".kilo", ".kilocode"].includes(dir ?? "")) return
  throw new Error(
    "Do not edit Agent Manager state directly. Use the agent_manager tool: call action=list to read section and session IDs, then call action=move with the returned IDs.",
  )
}
