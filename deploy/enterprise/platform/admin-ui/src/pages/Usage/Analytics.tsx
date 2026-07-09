import type { ProColumns } from "@ant-design/pro-components"
import { ProTable } from "@ant-design/pro-components"
import { Alert, Button, DatePicker, Space, Tabs } from "antd"
import dayjs, { type Dayjs } from "dayjs"
import { useCallback, useEffect, useState } from "react"
import {
  exportUsageAnalytics,
  fetchUsageAnalyticsReport,
  type UsageAnalyticsReport,
  type UsageDailyRow,
  type UsageIDERow,
  type UsageInactiveRow,
  type UsageUserRow,
} from "@/services/enterprise"

const { RangePicker } = DatePicker

function defaultRange(): [Dayjs, Dayjs] {
  const to = dayjs()
  const from = to.subtract(6, "day")
  return [from, to]
}

function fmtRate(v: number) {
  return `${v.toFixed(2)}%`
}

const userCols: ProColumns<UsageUserRow>[] = [
  { title: "排名", dataIndex: "rank", width: 60 },
  { title: "姓名", dataIndex: "name", width: 100 },
  { title: "邮箱", dataIndex: "email", width: 180, ellipsis: true },
  { title: "IDE", dataIndex: "ide", width: 160, ellipsis: true },
  { title: "活跃天数", dataIndex: "activeDays", width: 80 },
  { title: "趋势", dataIndex: "trend", width: 100 },
  { title: "补全建议", dataIndex: "completionSuggested", width: 90 },
  { title: "补全采纳", dataIndex: "completionAccepted", width: 90 },
  { title: "补全行数", dataIndex: "completionAcceptedLines", width: 90 },
  { title: "Agent触发", dataIndex: "agentTriggered", width: 90 },
  { title: "Agent改文件", dataIndex: "agentFileEdited", width: 100 },
  { title: "Agent采纳", dataIndex: "agentFileEditAccepted", width: 90 },
  { title: "补全字符", dataIndex: "completionAcceptedChars", width: 90 },
  { title: "inline字符", dataIndex: "inlineChars", width: 90 },
  { title: "Agent字符", dataIndex: "agentAcceptedChars", width: 90 },
  { title: "Token", dataIndex: "tokens", width: 100 },
  {
    title: "补全采纳率",
    dataIndex: "completionAcceptRate",
    width: 100,
    render: (_, row) => fmtRate(row.completionAcceptRate),
  },
  {
    title: "Agent采纳率",
    dataIndex: "agentEditAcceptRate",
    width: 100,
    render: (_, row) => fmtRate(row.agentEditAcceptRate),
  },
]

const ideCols: ProColumns<UsageIDERow>[] = [
  { title: "IDE", dataIndex: "ide", width: 100 },
  { title: "补全建议", dataIndex: "completionSuggested" },
  { title: "补全采纳", dataIndex: "completionAccepted" },
  { title: "Agent触发", dataIndex: "agentTriggered" },
  { title: "Agent改文件", dataIndex: "agentFileEdited" },
  { title: "Token", dataIndex: "tokens" },
]

const dailyCols: ProColumns<UsageDailyRow>[] = [
  { title: "日期", dataIndex: "date", width: 110 },
  { title: "姓名", dataIndex: "name", width: 100 },
  { title: "邮箱", dataIndex: "email", width: 160, ellipsis: true },
  { title: "IDE", dataIndex: "ide", width: 90 },
  { title: "补全建议", dataIndex: "completionSuggested", width: 90 },
  { title: "补全采纳", dataIndex: "completionAccepted", width: 90 },
  { title: "Token", dataIndex: "tokens", width: 100 },
]

const inactiveCols: ProColumns<UsageInactiveRow>[] = [
  { title: "姓名", dataIndex: "name" },
  { title: "邮箱", dataIndex: "email" },
]

export default function UsageAnalytics() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange)
  const [report, setReport] = useState<UsageAnalyticsReport | null>(null)
  const [loading, setLoading] = useState(false)

  const from = range[0].format("YYYY-MM-DD")
  const to = range[1].format("YYYY-MM-DD")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchUsageAnalyticsReport(from, to)
      setReport(data)
    } catch {
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const onExport = async () => {
    await exportUsageAnalytics(from, to)
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="使用分析按 Asia/Shanghai 自然日统计。注释/优化/人工字符 P2 为 0；jetbrains/android 暂无客户端数据时需 SSO 登录后由 VS Code 上报。"
      />
      <Space style={{ marginBottom: 16 }} wrap>
        <RangePicker
          value={range}
          onChange={(vals) => {
            if (vals?.[0] && vals[1]) setRange([vals[0], vals[1]])
          }}
          allowClear={false}
        />
        <Button onClick={() => void load()} loading={loading}>
          查询
        </Button>
        <Button type="primary" onClick={() => void onExport()} disabled={!report}>
          导出 xlsx
        </Button>
      </Space>

      <Tabs
        items={[
          {
            key: "users",
            label: "用户汇总",
            children: (
              <ProTable<UsageUserRow>
                rowKey="email"
                search={false}
                pagination={{ pageSize: 20 }}
                loading={loading}
                dataSource={report?.userSummary ?? []}
                columns={userCols}
                scroll={{ x: 1800 }}
              />
            ),
          },
          {
            key: "ide",
            label: "IDE 分类",
            children: (
              <ProTable<UsageIDERow>
                rowKey="ide"
                search={false}
                pagination={false}
                loading={loading}
                dataSource={report?.ideSummary ?? []}
                columns={ideCols}
              />
            ),
          },
          {
            key: "daily",
            label: "每日明细",
            children: (
              <ProTable<UsageDailyRow>
                rowKey={(row) => `${row.date}-${row.email}-${row.ide}`}
                search={false}
                pagination={{ pageSize: 30 }}
                loading={loading}
                dataSource={report?.dailyDetail ?? []}
                columns={dailyCols}
                scroll={{ x: 1200 }}
              />
            ),
          },
          {
            key: "inactive",
            label: "未使用用户",
            children: (
              <ProTable<UsageInactiveRow>
                rowKey="email"
                search={false}
                pagination={{ pageSize: 30 }}
                loading={loading}
                dataSource={report?.inactiveUsers ?? []}
                columns={inactiveCols}
              />
            ),
          },
        ]}
      />
    </div>
  )
}
