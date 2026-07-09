import { clearToken } from "@/services/enterprise"
import { history } from "@umijs/max"
import { Button, Result } from "antd"

export default function ForbiddenPage() {
  return (
    <Result
      status="403"
      title="无访问权限"
      subTitle="当前账号（如 developer / viewer）未分配管理后台角色。请联系租户管理员。"
      extra={
        <Button
          type="primary"
          onClick={() => {
            clearToken()
            history.push("/user/login")
          }}
        >
          退出并重新登录
        </Button>
      }
    />
  )
}
