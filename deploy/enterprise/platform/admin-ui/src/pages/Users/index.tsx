import type { ActionType, ProColumns } from "@ant-design/pro-components"
import { ModalForm, PageContainer, ProFormSelect, ProTable } from "@ant-design/pro-components"
import { Button, Descriptions, Drawer, message, Popconfirm, Space, Tag } from "antd"
import { useEffect, useRef, useState } from "react"
import { tableEmpty } from "@/components/EmptyTable"
import {
  assignRole,
  getUser,
  listRoles,
  listUsers,
  unassignRole,
  type Role,
  type User,
  type UserDetail,
} from "@/services/enterprise"

export default function UsersPage() {
  const actionRef = useRef<ActionType>()
  const [target, setTarget] = useState<User | null>(null)
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [roles, setRoles] = useState<Role[]>([])

  useEffect(() => {
    listRoles()
      .then(setRoles)
      .catch(() => {})
  }, [])

  const roleOptions = roles.map((r) => ({
    label: `${r.name} (${r.kind})`,
    value: r.name,
  }))

  const columns: ProColumns<User>[] = [
    { title: "邮箱", dataIndex: "email", copyable: true },
    { title: "显示名", dataIndex: "displayName", render: (_, r) => r.displayName || "—" },
    {
      title: "SSO",
      dataIndex: "ssoBound",
      width: 90,
      render: (_, row) => (
        <Tag color={row.ssoBound ? "green" : "default"}>{row.ssoBound ? "已绑定" : "未绑定"}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (_, row) => (
        <Tag color={row.status === "active" ? "green" : "default"}>{row.status}</Tag>
      ),
    },
    {
      title: "角色",
      dataIndex: "roles",
      render: (_, row) => (
        <Space wrap>
          {(row.roles ?? []).map((r) => (
            <Popconfirm
              key={r}
              title={`移除角色 ${r}？`}
              onConfirm={async () => {
                try {
                  await unassignRole(row.id, r)
                  message.success("已移除")
                  actionRef.current?.reload()
                } catch (e: any) {
                  message.error(e?.data?.error ?? e.message ?? "移除失败")
                }
              }}
            >
              <Tag closable onClose={(e) => e.preventDefault()} style={{ cursor: "pointer" }}>
                {r}
              </Tag>
            </Popconfirm>
          ))}
        </Space>
      ),
    },
    {
      title: "操作",
      valueType: "option",
      render: (_, row) => [
        <Button
          key="detail"
          type="link"
          onClick={async () => {
            try {
              setDetail(await getUser(row.id))
            } catch {
              message.error("加载详情失败")
            }
          }}
        >
          详情
        </Button>,
        <Button key="role" type="link" onClick={() => setTarget(row)}>
          分配角色
        </Button>,
      ],
    },
  ]

  return (
    <PageContainer subTitle="SSO 首次登录自动建档；详情可查看 oidc_sub">
      <ProTable<User>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        request={async () => {
          const data = await listUsers()
          return { data, success: true }
        }}
        columns={columns}
        locale={{ emptyText: tableEmpty }}
      />
      <Drawer
        title={detail ? `用户 — ${detail.email}` : "用户详情"}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        width={480}
      >
        {detail ? (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="ID">{detail.id}</Descriptions.Item>
            <Descriptions.Item label="邮箱">{detail.email}</Descriptions.Item>
            <Descriptions.Item label="显示名">{detail.displayName || "—"}</Descriptions.Item>
            <Descriptions.Item label="状态">{detail.status}</Descriptions.Item>
            <Descriptions.Item label="SSO">
              {detail.oidcSub ? <Tag color="green">已绑定</Tag> : <Tag>未绑定</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="oidc_sub">{detail.oidcSub || "—"}</Descriptions.Item>
            <Descriptions.Item label="角色">{(detail.roles ?? []).join(", ") || "—"}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{detail.createdAt || "—"}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
      <ModalForm
        title={target ? `分配角色 — ${target.email}` : "分配角色"}
        open={Boolean(target)}
        modalProps={{ destroyOnClose: true, onCancel: () => setTarget(null) }}
        onFinish={async (values) => {
          if (!target) return false
          try {
            await assignRole(target.id, values.role)
            message.success("角色已分配")
            setTarget(null)
            actionRef.current?.reload()
            return true
          } catch (e: any) {
            const msg = e?.data?.error ?? e.message
            if (String(msg).includes("three_admin_mutex")) {
              message.error("三员互斥：该用户已持有其他管理岗")
            } else {
              message.error(msg || "分配失败")
            }
            return false
          }
        }}
      >
        <ProFormSelect
          name="role"
          label="角色"
          options={roleOptions}
          rules={[{ required: true, message: "请选择角色" }]}
        />
      </ModalForm>
    </PageContainer>
  )
}
