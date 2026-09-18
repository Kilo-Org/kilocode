import type { Accessor, Component } from "solid-js"
import { DocumentPanel } from "../../documents/DocumentPanel"
import { createDocumentInspector } from "../../documents/state"

interface Props {
  inspector: ReturnType<typeof createDocumentInspector>
  onClosePanel: () => void
  onSendAll?: () => void
  activeTerminalId?: string
  visible: Accessor<boolean>
}

export const DocumentPanelHost: Component<Props> = (props) => (
  <DocumentPanel
    tabs={props.inspector.documents.tabs}
    active={props.inspector.documents.active}
    getData={props.inspector.documents.document}
    comments={props.inspector.comments.comments()}
    onCommentsChange={props.inspector.comments.setComments}
    onSelect={props.inspector.documents.select}
    onClose={props.inspector.documents.close}
    onCloseOthers={props.inspector.documents.closeOthers}
    onReorder={props.inspector.documents.reorder}
    onOpenFile={props.inspector.openFile}
    onClosePanel={props.onClosePanel}
    onSendAll={props.onSendAll}
    activeTerminalId={props.activeTerminalId}
    visible={props.visible}
  />
)
