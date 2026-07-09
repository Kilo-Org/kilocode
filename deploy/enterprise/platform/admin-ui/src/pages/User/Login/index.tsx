import { LockOutlined, LoginOutlined, UserOutlined } from "@ant-design/icons"
import { LoginForm, ProFormText } from "@ant-design/pro-components"
import { history, useModel } from "@umijs/max"
import { Alert, Button } from "antd"
import { useEffect, useState } from "react"
import { TOKEN_KEY } from "@/constants"
import { authStatus, devLogin, oidcLoginUrl } from "@/services/enterprise"
import styles from "./index.less"

export default function LoginPage() {
  const { refresh } = useModel("@@initialState")
  const [oidc, setOidc] = useState(false)
  const [err, setErr] = useState("")

  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY)) {
      history.push("/")
      return
    }
    authStatus()
      .then((s) => setOidc(Boolean(s.enabled)))
      .catch(() => setOidc(false))
  }, [])

  return (
    <div className={styles.page}>
      <div className="login-wrap">
        <LoginForm
          title="企业控制面"
          subTitle="Kilo 企业私有化 — 管理后台"
          contentStyle={{ minWidth: "unset", width: "100%", overflow: "hidden" }}
          containerStyle={{ overflow: "hidden", width: "100%" }}
          onFinish={async (values) => {
            setErr("")
            try {
              await devLogin(values.email)
              await refresh()
              history.push("/")
            } catch (e: any) {
              setErr(e?.data?.error ?? e.message ?? "登录失败")
            }
          }}
        >
          {err ? <Alert type="error" message={err} showIcon style={{ marginBottom: 16 }} /> : null}
          <ProFormText
            name="email"
            fieldProps={{ size: "large", prefix: <UserOutlined /> }}
            placeholder="邮箱"
            initialValue="admin@enterprise.local"
            rules={[{ required: true, message: "请输入邮箱" }]}
          />
          {oidc ? (
            <div className="login-extra">
              <Button
                block
                size="large"
                type="primary"
                icon={<LoginOutlined />}
                href={oidcLoginUrl()}
              >
                Logto / OIDC 登录
              </Button>
              <Alert
                type="info"
                showIcon
                icon={<LockOutlined />}
                message="生产环境请使用 OIDC；开发环境可用上方邮箱登录（需 PLATFORM_AUTH_DEV=1）"
              />
            </div>
          ) : null}
        </LoginForm>
      </div>
    </div>
  )
}
