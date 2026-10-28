import type { Component } from "solid-js"

export type PermissionTarget = { kind: "root" } | { kind: "agent"; name: string }

export interface PermissionEditorProps {
  target: PermissionTarget
}

/** Placeholder for the v2 permission editor. */
const PermissionEditor: Component<PermissionEditorProps> = () => null

export default PermissionEditor
