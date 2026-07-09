import type { ProColumns } from "@ant-design/pro-components"
import { PageContainer, ProTable, StatisticCard } from "@ant-design/pro-components"
import { Card, Col, Row, Segmented, Tabs, Tag } from "antd"
import { useEffect, useMemo, useState } from "react"
import {
  listLicenses,
  usageDetail,
  usageSummary,
  type License,
  type UsageDetail,
} from "@/services/enterprise"
import UsageAnalytics from "./Analytics"
import UsageAssessment from "./Assessment"

type ClientRow = UsageDetail["clients"][number]

function TrendChart({ daily }: { daily: UsageDetail["daily"] }) {
  const max = useMemo(() => Math.max(1, ...daily.map((d) => d.count)), [daily])
  if (daily.length === 0) {
    return <div style={{ color: "#999", padding: "24px 0" }}>所选时段暂无校验记录</div>
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 160, padding: "8px 0" }}>
      {daily.map((d) => (
        <div
          key={d.date}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
        >
          <span style={{ fontSize: 12 }}>{d.count}</span>
          <div
            style={{
              width: "100%",
              maxWidth: 48,
              height: `${Math.round((d.count / max) * 120)}px`,
              minHeight: d.count > 0 ? 4 : 0,
              background: "#1677ff",
              borderRadius: 4,
            }}
          />
          <span style={{ fontSize: 11, color: "#666", transform: "rotate(-35deg)", marginTop: 8 }}>
            {d.date.slice(5)}
          </span>
        </div>
      ))}
    </div>
  )
}

function LicenseUsagePanel() {
  const [sum, setSum] = useState({ licenseUsage: 0, users: 0 })
  const [days, setDays] = useState<number>(7)
  const [detail, setDetail] = useState<UsageDetail>({ days: 7, daily: [], clients: [] })
  const [licenses, setLicenses] = useState<License[]>([])

  useEffect(() => {
    usageSummary().then(setSum).catch(() => {})
    listLicenses().then(setLicenses).catch(() => {})
  }, [])

  useEffect(() => {
    usageDetail(days).then(setDetail).catch(() => {})
  }, [days])

  const clientCols: ProColumns<ClientRow>[] = [
    { title: "客户端", dataIndex: "client", width: 100 },
    { title: "机器 ID", dataIndex: "machineId", ellipsis: true },
    { title: "校验次数", dataIndex: "count", width: 100 },
    { title: "最近校验", dataIndex: "lastAt", valueType: "dateTime", width: 180 },
  ]

  const licenseCols: ProColumns<License>[] = [
    { title: "License Key", dataIndex: "licenseKey", width: 180 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (_, row) => {
        const color =
          row.status === "active" ? "green" : row.status === "readonly" ? "orange" : "red"
        return <Tag color={color}>{row.status}</Tag>
      },
    },
    {
      title: "到期时间",
      dataIndex: "expiresAt",
      valueType: "dateTime",
      width: 180,
      render: (_, row) =>
        row.expiringSoon ? (
          <Tag color="orange">
            {row.expiresAt}（还剩 {row.daysLeft} 天）
          </Tag>
        ) : (
          row.expiresAt
        ),
    },
    { title: "累计校验", dataIndex: "usageCount", width: 100 },
    { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime", width: 180 },
  ]

  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <StatisticCard statistic={{ title: "License 校验次数", value: sum.licenseUsage }} />
        </Col>
        <Col span={12}>
          <StatisticCard statistic={{ title: "用户数", value: sum.users }} />
        </Col>
      </Row>

      <Card
        title="校验趋势"
        extra={
          <Segmented
            options={[
              { label: "近 7 天", value: 7 },
              { label: "近 30 天", value: 30 },
            ]}
            value={days}
            onChange={(v) => setDays(v as number)}
          />
        }
        style={{ marginBottom: 16 }}
      >
        <TrendChart daily={detail.daily} />
      </Card>

      <ProTable<ClientRow>
        headerTitle="按终端聚合"
        rowKey={(row) => `${row.client}-${row.machineId}`}
        search={false}
        pagination={false}
        dataSource={detail.clients}
        columns={clientCols}
        style={{ marginBottom: 16 }}
      />

      <ProTable<License>
        headerTitle="License 列表"
        rowKey="id"
        search={false}
        pagination={false}
        dataSource={licenses}
        columns={licenseCols}
      />
    </>
  )
}

export default function UsagePage() {
  return (
    <PageContainer subTitle="License 校验与 IDE 使用分析（Asia/Shanghai）">
      <Tabs
        items={[
          { key: "analytics", label: "使用分析", children: <UsageAnalytics /> },
          { key: "assessment", label: "效能考核", children: <UsageAssessment /> },
          { key: "license", label: "License 校验", children: <LicenseUsagePanel /> },
        ]}
      />
    </PageContainer>
  )
}
