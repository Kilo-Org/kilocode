export * as KiloOauthCallbackPage from "./page"

import { OauthCallbackPage, type CallbackPageOptions } from "../../oauth/page"

function brand(page: string) {
  return page.replaceAll("OpenCode", "Kilo")
}

export function success(options?: CallbackPageOptions) {
  return brand(OauthCallbackPage.success(options))
}

export function error(detail: string, options?: CallbackPageOptions) {
  return brand(OauthCallbackPage.error(detail, options))
}
