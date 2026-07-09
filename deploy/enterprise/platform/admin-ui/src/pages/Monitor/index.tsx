import { PageContainer } from "@ant-design/pro-components"
import { Button, Card, Col, Empty, Row, Tag, Typography } from "antd"
import { useEffect, useState } from "react"
import { monitorHealth, type HealthItem } from "@/services/enterprise"

function statusColor(status: string) {
  if (status === "up") return "success"
  if (status === "degraded") return "warning"
  if (status === "skipped") return "default"
  return "error"
}

function HealthCard({ item }: { item: HealthItem }) {
  return (
    <Card title={item.name} size="small">
      <Tag color={statusColor(item.status)}>{item.status}</Tag>
      {item.code ? <Typography.Text type="secondary"> HTTP {item.code}</Typography.Text> : null}
      {item.url ? (
        <Typography.Paragraph ellipsis copyable={{ text: item.url }} style={{ marginTop: 8, marginBottom: 0 }}>
          {item.url}
        </Typography.Paragraph>
      ) : null}
    </Card>
  )
}

export default function MonitorPage() {
  const [items, setItems] = useState<HealthItem[]>([])
  const [at, setAt] = useState("")

  const load = () => {
    monitorHealth().then((data) => {
      setItems(data.items ?? [])
      setAt(data.at)
    })
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <PageContainer
      subTitle={at ? `更新时间 ${at}` : "Engine / Bridge / Gateway 探活"}
      extra={[
        <Button key="reload" onClick={load}>
          刷新
        </Button>,
      ]}
    >
      {items.length === 0 ? (
        <Empty description="暂无探活数据，请点击刷新重试" />
      ) : (
        <Row gutter={[16, 16]}>
          {items.map((item) => (
            <Col xs={24} sm={12} lg={6} key={item.name}>
              <HealthCard item={item} />
            </Col>
          ))}
        </Row>
      )}
    </PageContainer>
  )
}
