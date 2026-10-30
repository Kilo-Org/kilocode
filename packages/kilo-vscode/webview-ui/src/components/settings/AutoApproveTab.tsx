import type { Component } from "solid-js"

import PermissionEditor from "./PermissionEditor"

const AutoApproveTab: Component = () => <PermissionEditor target={{ kind: "root" }} />

export default AutoApproveTab
