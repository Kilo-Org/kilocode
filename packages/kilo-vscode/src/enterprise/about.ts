import * as vscode from "vscode"
import { enterpriseSettings } from "./settings"

const NOTICE = `本产品基于 Kilo Code（https://github.com/Kilo-Org/kilocode）构建。

Kilo Code 采用 Apache License 2.0 开源协议。版权所有 (C) Kilo-Org 及其贡献者。

企业增值层（License 管理、RBAC、审计合规、私有化部署等）为自主开发，与 Kilo Code 开源项目相互独立。

完整许可证文本请参阅扩展安装目录下的 LICENSE 及上游仓库 LICENSE 文件。`

export function registerEnterpriseAbout(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("kilo-code.new.enterprise.showAbout", async () => {
      const name = enterpriseSettings().productName.trim() || context.extension.packageJSON.displayName
      const detail = `${name}\n\n${NOTICE}`
      const pick = await vscode.window.showInformationMessage(
        `${name} — 开源与版权声明`,
        { modal: true, detail },
        "复制声明",
      )
      if (pick === "复制声明") {
        await vscode.env.clipboard.writeText(NOTICE)
      }
    }),
  )
}
