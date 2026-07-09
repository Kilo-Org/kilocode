import { history, useAccess } from "@umijs/max"
import { useEffect } from "react"

const order: [keyof ReturnType<typeof useAccess>, string][] = [
  ["canTenants", "/tenants"],
  ["canUsers", "/users"],
  ["canUsage", "/usage"],
  ["canModel", "/model"],
  ["canMonitor", "/monitor"],
  ["canAudit", "/audit"],
  ["canIndex", "/index"],
  ["canSecurity", "/security"],
]

export default function HomePage() {
  const access = useAccess()

  useEffect(() => {
    for (const [key, path] of order) {
      if (access[key]) {
        history.replace(path)
        return
      }
    }
    history.replace("/403")
  }, [access])

  return null
}
