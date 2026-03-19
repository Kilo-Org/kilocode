/**
 * PermissionCommand component
 * Renders a bash command with preserved newlines, scrollable when long.
 */

import { Component } from "solid-js"

export const PermissionCommand: Component<{ command: string }> = (props) => (
  <pre data-slot="permission-command">{props.command}</pre>
)
