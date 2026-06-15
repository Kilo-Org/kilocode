import * as vscode from "vscode"
import { engineBaseUrl } from "./gateway"
import { ensureLicense } from "./license"
import { enterpriseSettings } from "./settings"

export type EnterpriseStatusPayload = {
  type: "enterpriseLicenseStatus"
  licenseEnabled: boolean
  licenseOk: boolean
  licenseReason: string
  licenseReadonly: boolean
  remoteEnabled: boolean
  engineUrl: string
  gatewayUrl: string
  productName: string
}

export async function buildEnterpriseStatus(context: vscode.ExtensionContext): Promise<EnterpriseStatusPayload> {
  const ent = enterpriseSettings()
  const license = await ensureLicense(context)
  return {
    type: "enterpriseLicenseStatus",
    licenseEnabled: ent.license.enabled,
    licenseOk: license.ok,
    licenseReason: license.reason,
    licenseReadonly: license.readonly ?? false,
    remoteEnabled: ent.remote.enabled,
    engineUrl: ent.remote.enabled ? engineBaseUrl(ent) : "",
    gatewayUrl: ent.gatewayUrl,
    productName: ent.productName,
  }
}
