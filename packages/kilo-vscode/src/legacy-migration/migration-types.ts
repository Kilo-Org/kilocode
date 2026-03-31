export interface MigrationResultItem {
  item: string
  category: "provider" | "mcpServer" | "customMode" | "defaultModel" | "settings" | "session"
  status: "success" | "warning" | "error"
  message?: string
}
