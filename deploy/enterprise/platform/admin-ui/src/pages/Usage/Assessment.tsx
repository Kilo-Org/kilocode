import type { ProColumns } from "@ant-design/pro-components"
import { ProTable } from "@ant-design/pro-components"
import { Alert, Button, DatePicker, Space, Statistic, Row, Col, Card, Tag } from "antd"
import dayjs, { type Dayjs } from "dayjs"
import { useCallback, useEffect, useState } from "react"
import {
  exportAssessmentReport,
  fetchAssessmentReport,
  type AssessmentReport,
  type AssessmentRow,
  type GradeCount,
} from "@/services/enterprise"

const { RangePicker } = DatePicker

function defaultRange(): [Dayjs, Dayjs] {
  const to = dayjs()
  const from = to.subtract(6, "day")
  return [from, to]
}

function gradeColor(grade: string) {
  if (grade.startsWith("A")) return "green"
  if (grade.startsWith("B")) return "blue"
  if (grade.startsWith("C")) return "default"
  if (grade.startsWith("D")) return "orange"
  return "red"
}

const cols: ProColumns<AssessmentRow>[] = [
  { title: "排名", dataIndex: "rank", width: 60 },
  { title: "姓名", dataIndex: "name", width: 100 },
  { title: "邮箱", dataIndex: "email", width: 180, ellipsis: true },
  { title: "活跃天数", dataIndex: "activeDays", width: 80 },
  { title: "AI总采纳字符", dataIndex: "aiAcceptedChars", width: 110 },
  { title: "Token", dataIndex: "tokens", width: 100 },
  { title: "活跃参与", dataIndex: "activeParticipation", width: 90 },
  { title: "有效产出(40%)", dataIndex: "outputScore", width: 110 },
  { title: "交互深度(30%)", dataIndex: "tokenScore", width: 110 },
  { title: "活跃参与(30%)", dataIndex: "activeScore", width: 110 },
  { title: "基础得分", dataIndex: "baseScore", width: 90 },
  { title: "效率乘数", dataIndex: "efficiencyMult", width: 90 },
  { title: "综合得分", dataIndex: "compositeScore", width: 90 },
  {
    title: "考核等级",
    dataIndex: "grade",
    width: 100,
    render: (_, row) => <Tag color={gradeColor(row.grade)}>{row.grade}</Tag>,
  },
]

const summaryCols: ProColumns<GradeCount>[] = [
  { title: "等级", dataIndex: "grade" },
  { title: "人数", dataIndex: "count" },
]

export default function UsageAssessment() {
  const [range, setRange] = useState<[Dayjs, Dayjs]>(defaultRange)
  const [report, setReport] = useState<AssessmentReport | null>(null)
  const [loading, setLoading] = useState(false)

  const from = range[0].format("YYYY-MM-DD")
  const to = range[1].format("YYYY-MM-DD")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchAssessmentReport(from, to)
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
    await exportAssessmentReport(from, to)
  }

  const total = report?.rows.length ?? 0
  const avg =
    total > 0
      ? (report!.rows.reduce((s, r) => s + r.compositeScore, 0) / total).toFixed(1)
      : "—"

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="效能考核（Phase A）：综合分 = [有效产出40% + 交互深度30% + 活跃参与30%] × 效率乘数(0.82～1.15)。数据来自使用分析聚合，不含经理考核与人工产出。"
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

      {report && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small">
              <Statistic title="考核人数" value={total} />
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small">
              <Statistic title="平均综合分" value={avg} />
            </Card>
          </Col>
          <Col span={12}>
            <ProTable<GradeCount>
              rowKey="grade"
              search={false}
              pagination={false}
              toolBarRender={false}
              dataSource={report.gradeSummary}
              columns={summaryCols}
              size="small"
            />
          </Col>
        </Row>
      )}

      <ProTable<AssessmentRow>
        rowKey="email"
        search={false}
        pagination={{ pageSize: 20 }}
        loading={loading}
        dataSource={report?.rows ?? []}
        columns={cols}
        scroll={{ x: 1500 }}
      />
    </div>
  )
}
