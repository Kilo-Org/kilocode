package ai.kilocode.client.settings.base

import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.ui.TextFieldWithBrowseButton
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.components.JBTextField
import javax.swing.JComponent

internal fun settingsPathInput(
    field: JBTextField,
    choose: (JComponent) -> String?,
): TextFieldWithBrowseButton = TextFieldWithBrowseButton(field).apply {
    addActionListener {
        choose(this)?.let { field.text = it }
    }
}

internal fun settingsChoosePath(parent: JComponent, descriptor: FileChooserDescriptor): String? {
    return FileChooser.chooseFile(descriptor, parent, null, null as VirtualFile?)?.path
}
