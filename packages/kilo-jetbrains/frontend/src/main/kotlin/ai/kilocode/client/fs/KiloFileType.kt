package ai.kilocode.client.fs

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileType
import javax.swing.Icon

object KiloFileType : FileType {
    override fun getName(): String = "Kilo"

    override fun getDescription(): String = "Kilo virtual editor"

    override fun getDefaultExtension(): String = ""

    override fun getIcon(): Icon = AllIcons.General.User

    override fun isBinary(): Boolean = false

    override fun isReadOnly(): Boolean = true
}
