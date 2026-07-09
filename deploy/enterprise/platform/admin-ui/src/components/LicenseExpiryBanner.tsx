import { Alert } from "antd"
import { useEffect, useState } from "react"
import { fetchLicenseStatus, type LicenseStatus } from "@/services/enterprise"

export default function LicenseExpiryBanner() {
  const [status, setStatus] = useState<LicenseStatus | null>(null)

  useEffect(() => {
    fetchLicenseStatus()
      .then(setStatus)
      .catch(() => setStatus(null))
  }, [])

  if (!status?.expiringSoon) return null

  const expires = status.expiresAt ? new Date(status.expiresAt).toLocaleString() : ""
  return (
    <Alert
      type="warning"
      showIcon
      banner
      message={`授权将于 ${expires} 到期（还剩 ${status.daysLeft} 天）`}
      description="请联系软件供应商续期，并在租户页重新上传新的授权文件。过期后将按现有策略进入只读模式。"
      style={{ marginBottom: 16 }}
    />
  )
}
