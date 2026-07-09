import { history, RequestConfig, RunTimeLayoutConfig } from "@umijs/max"
import { message, Space, Tag } from "antd"
import { canEnterAdmin } from "@/access"
import LicenseExpiryBanner from "@/components/LicenseExpiryBanner"
import { TOKEN_KEY } from "@/constants"
import { clearToken, fetchMe } from "@/services/enterprise"

export async function getInitialState() {
  const path = history.location.pathname
  if (path.startsWith("/user/login")) {
    return { name: "Guest", roles: [] as string[] }
  }
  const token = localStorage.getItem(TOKEN_KEY)
  if (!token) {
    history.push("/user/login")
    return { name: "Guest", roles: [] as string[] }
  }
  try {
    const me = await fetchMe()
    const roles = me.roles ?? []
    if (!canEnterAdmin(roles) && !path.startsWith("/403")) {
      history.push("/403")
      return { name: me.id, tenant: me.tenant_id, roles }
    }
    return {
      name: me.id,
      tenant: me.tenant_id,
      roles,
    }
  } catch {
    clearToken()
    history.push("/user/login")
    return { name: "Guest", roles: [] as string[] }
  }
}

export const layout: RunTimeLayoutConfig = ({ initialState }) => ({
  logout: () => {
    clearToken()
    history.push("/user/login")
  },
  childrenRender: (children) => (
    <>
      <LicenseExpiryBanner />
      {children}
    </>
  ),
  onPageChange: () => {
    const token = localStorage.getItem(TOKEN_KEY)
    const path = history.location.pathname
    if (!token && !path.startsWith("/user/login")) {
      history.push("/user/login")
    }
  },
  rightContentRender: () => {
    const tenant = initialState?.tenant
    const roles = initialState?.roles ?? []
    if (!tenant && roles.length === 0) return null
    const short = tenant ? `${tenant.slice(0, 8)}…` : ""
    return (
      <Space size={4} wrap>
        {tenant ? <Tag>租户 {short}</Tag> : null}
        {roles.map((role) => (
          <Tag key={role} color="blue">
            {role}
          </Tag>
        ))}
      </Space>
    )
  },
})

export const request: RequestConfig = {
  errorConfig: {
    errorHandler(error: any) {
      const status = error?.response?.status
      const body = error?.data ?? error?.info?.error
      const text = typeof body === "string" ? body : body?.error ?? error.message
      if (status === 401) {
        clearToken()
        history.push("/user/login")
        message.error("登录已过期，请重新登录")
        return
      }
      if (status === 403) {
        message.error("无权限执行此操作")
        return
      }
      if (status === 409 && String(text).includes("three_admin_mutex")) {
        message.error("三员互斥：系统/安全/审计管理岗不能授予同一用户")
        return
      }
      message.error(text || "请求失败")
    },
  },
  requestInterceptors: [
    (url, options) => {
      const token = localStorage.getItem(TOKEN_KEY)
      if (!token) return { url, options }
      return {
        url,
        options: {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
          },
        },
      }
    },
  ],
}
