export interface MigrationResultItem {
  item: string
  category: "session"
  status: "success" | "warning" | "error"
  message?: string
}
