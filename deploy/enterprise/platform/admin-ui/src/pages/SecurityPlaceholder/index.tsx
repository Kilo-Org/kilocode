import { PageContainer } from "@ant-design/pro-components"
import { Result } from "antd"

export default function SecurityPlaceholderPage() {
  return (
    <PageContainer>
      <Result
        status="info"
        title="安全报告"
        subTitle="Semgrep SAST 与安全扫描报告为可选扩展能力，部署与启用方式请联系软件供应商。"
      />
    </PageContainer>
  )
}
