@file:Suppress("LeakingThis")

package ai.kilocode.client.vfs

import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManagerKeys
import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.fileTypes.FileTypes
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFilePathWrapper
import com.intellij.openapi.vfs.VirtualFileWithoutContent
import java.io.InputStream
import java.io.OutputStream

class KiloVirtualFile(
    val path: KiloPath,
) : VirtualFile(),
    VirtualFileWithoutContent,
    VirtualFilePathWrapper {
    init {
        putUserData(FileEditorManagerKeys.FORBID_TAB_SPLIT, true)
    }

    override fun getFileSystem(): KiloVirtualFileSystem = KiloVirtualFileSystem.getInstance()
    override fun getFileType(): FileType = FileTypes.UNKNOWN
    override fun getPath(): String = fileSystem.getPath(path)
    override fun getUrl(): String = "${fileSystem.protocol}://$path"
    override fun getName(): String = kind()?.title(path.params) ?: path.kind
    override fun getPresentableName(): String = name
    override fun getPresentablePath(): String = kind()?.presentablePath(path.params) ?: name
    override fun enforcePresentableName(): Boolean = true
    override fun isValid(): Boolean = kind()?.isValid(path.params) == true
    override fun isWritable(): Boolean = false
    override fun isDirectory(): Boolean = false
    override fun getParent(): VirtualFile? = null
    override fun getChildren(): Array<VirtualFile> = emptyArray()
    override fun getLength(): Long = 0
    override fun getTimeStamp(): Long = 0
    override fun getModificationStamp(): Long = 0
    override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) {
        postRunnable?.run()
    }

    override fun contentsToByteArray(): ByteArray = throw UnsupportedOperationException()
    override fun getInputStream(): InputStream = throw UnsupportedOperationException()
    override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream =
        throw UnsupportedOperationException()

    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is KiloVirtualFile) return false
        return path == other.path
    }

    override fun hashCode(): Int = path.hashCode()

    private fun kind(): KiloVirtualFileKind? = service<KiloVirtualFileKindRegistry>().get(path.kind)
}
