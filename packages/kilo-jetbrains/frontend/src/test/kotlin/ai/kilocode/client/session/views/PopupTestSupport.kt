package ai.kilocode.client.session.views

import com.intellij.ui.EditorTextField
import javax.swing.JComponent

/** Collects every code editor nested anywhere inside a built header popup body. */
internal fun popupEditors(root: JComponent): List<EditorTextField> {
    val found = mutableListOf<EditorTextField>()
    fun visit(component: JComponent) {
        if (component is EditorTextField) found.add(component)
        component.components.filterIsInstance<JComponent>().forEach(::visit)
    }
    visit(root)
    return found
}
