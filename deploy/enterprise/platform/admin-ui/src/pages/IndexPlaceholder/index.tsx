import { PageContainer } from "@ant-design/pro-components"
import { Result } from "antd"

export default function IndexPlaceholderPage() {
  return (
    <PageContainer>
      <Result
        status="info"
        title="代码索引"
        subTitle="语义索引与 Qdrant 管道为可选扩展能力，部署与启用方式请联系软件供应商。"
      />
    </PageContainer>
  )
}
