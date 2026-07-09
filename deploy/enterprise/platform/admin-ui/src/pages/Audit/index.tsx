import type { ProColumns } from "@ant-design/pro-components"
import { PageContainer, ProTable } from "@ant-design/pro-components"
import { tableEmpty } from "@/components/EmptyTable"
import { listAudit, type AuditRow } from "@/services/enterprise"

const KIND_OPTIONS = [
  { label: "model_config", value: "model_config" },
  { label: "model_apply", value: "model_apply" },
]

export default function AuditPage() {
  const columns: ProColumns<AuditRow>[] = [
    { title: "ID", dataIndex: "id", width: 80, hideInSearch: true },
    {
      title: "类型",
      dataIndex: "kind",
      width: 140,
      valueType: "select",
      fieldProps: { options: KIND_OPTIONS, allowClear: true },
    },
    { title: "摘要", dataIndex: "summary", ellipsis: true, hideInSearch: true },
    { title: "操作人", dataIndex: "actorId", width: 280, ellipsis: true, hideInSearch: true },
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 200,
      valueType: "dateTime",
      hideInSearch: true,
    },
    {
      title: "时间范围",
      dataIndex: "createdAtRange",
      valueType: "dateRange",
      hideInTable: true,
      search: {
        transform: (value) => ({
          from: value?.[0],
          to: value?.[1],
        }),
      },
    },
  ]

  return (
    <PageContainer subTitle="配置变更记录；支持类型与时间筛选、分页">
      <ProTable<AuditRow>
        rowKey="id"
        columns={columns}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: tableEmpty }}
        request={async (params) => {
          const day = (v: unknown) => {
            if (!v) return undefined
            if (typeof v === "string") return v.slice(0, 10)
            if (typeof v === "object" && v !== null && "format" in v) {
              return (v as { format: (s: string) => string }).format("YYYY-MM-DD")
            }
            return undefined
          }
          const data = await listAudit({
            kind: params.kind,
            from: day(params.from),
            to: day(params.to),
            page: params.current,
            pageSize: params.pageSize,
          })
          return { data: data.items, total: data.total, success: true }
        }}
      />
    </PageContainer>
  )
}
