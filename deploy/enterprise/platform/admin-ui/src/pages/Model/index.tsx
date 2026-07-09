import { PageContainer, ProForm, ProFormSelect, ProFormText } from "@ant-design/pro-components"
import { useAccess } from "@umijs/max"
import { Alert, Button, message, Space } from "antd"
import { useState } from "react"
import { PROVIDERS } from "@/constants"
import { applyModelConfig, getModelConfig, saveModelConfig } from "@/services/enterprise"

export default function ModelPage() {
  const access = useAccess()
  const readonly = !access.canModelWrite
  const [applyOut, setApplyOut] = useState("")

  return (
    <PageContainer
      subTitle={
        readonly
          ? "安全管理员只读；编辑与下发需 tenant_admin / sys_admin"
          : "保存后需「下发 Engine」使 kilo-engine 加载 generated.kilo.jsonc"
      }
    >
      <ProForm
        readonly={readonly}
        request={async () => {
          try {
            return await getModelConfig()
          } catch {
            return { provider: "deepseek" }
          }
        }}
        submitter={{
          render: (_, dom) => (
            <Space>
              {readonly ? null : dom}
              {readonly ? null : (
                <Button
                  onClick={async () => {
                    try {
                      const out = await applyModelConfig()
                      setApplyOut(JSON.stringify(out, null, 2))
                      message.success("已下发 Engine")
                    } catch {
                      message.error("下发失败")
                    }
                  }}
                >
                  下发 Engine
                </Button>
              )}
            </Space>
          ),
        }}
        onFinish={async (values) => {
          await saveModelConfig(values)
          message.success("已保存")
          return true
        }}
      >
        <ProFormSelect name="provider" label="Provider" options={PROVIDERS} rules={[{ required: true }]} />
        <ProFormText name="apiBase" label="API Base" placeholder="https://api.deepseek.com/v1" />
        <ProFormText name="defaultModel" label="默认模型" rules={[{ required: true }]} />
        <ProFormText name="smallModel" label="小模型" />
        <ProFormSelect
          name="fallbackProvider"
          label="Fallback Provider"
          options={[{ label: "无", value: "" }, ...PROVIDERS]}
        />
        <ProFormText
          name="apiKeyEnv"
          label="API Key 环境变量"
          placeholder="KILO_CUSTOM_API_KEY"
          tooltip="Engine 容器内读取的环境变量名，不下发明文密钥；下发后 kilo.jsonc 中为 {env:NAME}"
          rules={[
            {
              pattern: /^$|^[A-Z][A-Z0-9_]{0,63}$/,
              message: "须为大写字母、数字、下划线，且以字母开头",
            },
          ]}
        />
      </ProForm>
      {applyOut ? (
        <Alert
          style={{ marginTop: 16 }}
          type="success"
          message="下发结果"
          description={<pre style={{ margin: 0 }}>{applyOut}</pre>}
        />
      ) : null}
    </PageContainer>
  )
}
