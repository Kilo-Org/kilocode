import * as vscode from "vscode"
import { buildEnterpriseStatus } from "./status"

type Post = (msg: unknown) => void

export async function sendEnterpriseStatus(context: vscode.ExtensionContext | undefined, post: Post) {
  if (!context) return
  post(await buildEnterpriseStatus(context))
}

export async function handleEnterpriseMessage(
  type: string,
  context: vscode.ExtensionContext | undefined,
  post: Post,
) {
  if (type !== "requestEnterpriseLicense") return
  await sendEnterpriseStatus(context, post)
}
