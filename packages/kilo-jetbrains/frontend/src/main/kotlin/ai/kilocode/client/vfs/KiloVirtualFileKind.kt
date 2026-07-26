package ai.kilocode.client.vfs

import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypes
import javax.swing.Icon

interface KiloVirtualFileKind {
    val id: String

    fun title(params: Map<String, String>): String

    fun icon(params: Map<String, String>): Icon? = null

    fun fileType(params: Map<String, String>): FileType = FileTypes.UNKNOWN

    fun presentablePath(params: Map<String, String>): String = title(params)

    fun isValid(params: Map<String, String>): Boolean = true
}
