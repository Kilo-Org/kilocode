import type { ActionType, ProColumns } from "@ant-design/pro-components"
import { ModalForm, PageContainer, ProFormSelect, ProFormText, ProTable } from "@ant-design/pro-components"
import { useAccess } from "@umijs/max"
import { Button, message, Modal, Tag, Upload } from "antd"
import type { UploadFile } from "antd/es/upload/interface"
import { useRef, useState } from "react"
import { tableEmpty } from "@/components/EmptyTable"
import {
  createTenant,
  licenseImportError,
  listTenants,
  patchTenant,
  uploadTenantLicense,
  type OfflineLicenseFile,
  type Tenant,
} from "@/services/enterprise"

const STATUS_OPTIONS = [
  { label: "启用 (active)", value: "active" },
  { label: "停用 (suspended)", value: "suspended" },
]

export default function TenantsPage() {
  const actionRef = useRef<ActionType>()
  const access = useAccess()
  const [edit, setEdit] = useState<Tenant | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [importTarget, setImportTarget] = useState<Tenant | null>(null)
  const [importFile, setImportFile] = useState<UploadFile | null>(null)
  const [importing, setImporting] = useState(false)

  const columns: ProColumns<Tenant>[] = [
    { title: "名称", dataIndex: "name" },
    {
      title: "状态",
      dataIndex: "status",
      render: (_, row) => (
        <Tag color={row.status === "active" ? "green" : "default"}>{row.status}</Tag>
      ),
    },
    { title: "创建时间", dataIndex: "createdAt", valueType: "dateTime" },
    {
      title: "License 到期",
      dataIndex: "licenseExpiresAt",
      valueType: "dateTime",
      render: (_, row) => {
        if (!row.licenseExpiresAt) return "—"
        if (row.licenseExpiringSoon) {
          return (
            <Tag color="orange">
              {row.licenseExpiresAt}（还剩 {row.licenseDaysLeft} 天）
            </Tag>
          )
        }
        return row.licenseExpiresAt
      },
    },
    {
      title: "操作",
      valueType: "option",
      render: (_, row) => [
        <Button key="edit" type="link" onClick={() => setEdit(row)}>
          编辑
        </Button>,
        access.canTenants ? (
          <Button key="license" type="link" onClick={() => setImportTarget(row)}>
            上传授权文件
          </Button>
        ) : null,
      ],
    },
  ]

  const closeImport = () => {
    setImportTarget(null)
    setImportFile(null)
  }

  const submitImport = async () => {
    if (!importTarget || !importFile?.originFileObj) {
      message.warning("请选择 .json License 文件")
      return
    }
    setImporting(true)
    try {
      const text = await importFile.originFileObj.text()
      const body = JSON.parse(text) as OfflineLicenseFile
      await uploadTenantLicense(importTarget.id, body)
      message.success("授权已激活")
      closeImport()
      actionRef.current?.reload()
    } catch (err: unknown) {
      const e = err as {
        data?: { error?: string }
        response?: { data?: { error?: string } }
        info?: { error?: string }
        message?: string
      }
      const code =
        e?.response?.data?.error ?? e?.data?.error ?? e?.info?.error ?? "import_failed"
      message.error(licenseImportError(code))
    } finally {
      setImporting(false)
    }
  }

  return (
    <PageContainer subTitle="离线授权：由软件供应商签发的 License 文件，由租户管理员在本页自行上传激活">
      <ProTable<Tenant>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        toolBarRender={() =>
          access.canTenantsCreate
            ? [
                <Button key="new" type="primary" onClick={() => setCreateOpen(true)}>
                  新建租户
                </Button>,
              ]
            : []
        }
        request={async () => {
          const data = await listTenants()
          return { data, success: true }
        }}
        columns={columns}
        locale={{ emptyText: tableEmpty }}
      />
      <ModalForm
        title={edit ? `编辑租户 — ${edit.name}` : "编辑租户"}
        open={Boolean(edit)}
        modalProps={{ destroyOnClose: true, onCancel: () => setEdit(null) }}
        initialValues={edit ?? undefined}
        onFinish={async (values) => {
          if (!edit) return false
          await patchTenant(edit.id, { name: values.name, status: values.status })
          message.success("已保存")
          setEdit(null)
          actionRef.current?.reload()
          return true
        }}
      >
        <ProFormText name="name" label="名称" rules={[{ required: true }]} />
        <ProFormSelect name="status" label="状态" options={STATUS_OPTIONS} rules={[{ required: true }]} />
      </ModalForm>
      <ModalForm
        title="新建租户"
        open={createOpen}
        modalProps={{ destroyOnClose: true, onCancel: () => setCreateOpen(false) }}
        onFinish={async (values) => {
          await createTenant(values.name)
          message.success("租户已创建")
          setCreateOpen(false)
          actionRef.current?.reload()
          return true
        }}
      >
        <ProFormText name="name" label="名称" rules={[{ required: true }]} />
      </ModalForm>
      <Modal
        title={importTarget ? `上传授权文件 — ${importTarget.name}` : "上传授权文件"}
        open={Boolean(importTarget)}
        onCancel={closeImport}
        onOk={submitImport}
        confirmLoading={importing}
        okText="激活"
        destroyOnClose
      >
        <p>
          请上传软件供应商提供的离线 License 文件（.json）。该文件由供应商在贵司环境外签发，私有化部署仅做验签与入库，无法在本地自行生成。
        </p>
        <p>文件需包含 key、expiresAt 与 signature 字段；上传成功后「License 到期」列将更新。</p>
        <Upload
          accept=".json,application/json"
          maxCount={1}
          beforeUpload={() => false}
          fileList={importFile ? [importFile] : []}
          onRemove={() => setImportFile(null)}
          onChange={({ fileList }) => setImportFile(fileList[0] ?? null)}
        >
          <Button>选择文件</Button>
        </Upload>
      </Modal>
    </PageContainer>
  )
}
