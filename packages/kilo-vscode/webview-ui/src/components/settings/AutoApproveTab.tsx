import { Component, createMemo } from "solid-js"

import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import PermissionEditor from "./PermissionEditor"

const AutoApproveTab: Component = () => {
  const { config, updateConfig } = useConfig()
  const language = useLanguage()

  const permissions = createMemo(() => config().permission ?? {})

  return (
    <PermissionEditor
      permissions={permissions()}
      description={language.t("settings.autoApprove.description")}
      onChange={(patch) => updateConfig({ permission: patch })}
    />
  )
}

export default AutoApproveTab
