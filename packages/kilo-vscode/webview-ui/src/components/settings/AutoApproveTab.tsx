import type { Component } from "solid-js"

import PermissionEditor from "./PermissionEditor"

/** Auto-Approve runs on the root `permissions` ruleset. The cost alert has no v2 contract. */
const AutoApproveTab: Component = () => <PermissionEditor target={{ kind: "root" }} />

export default AutoApproveTab
