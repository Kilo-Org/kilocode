package ai.kilocode.client.fs

import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileSystem
import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

class KiloVirtualFile(
    private val fs: KiloVirtualFileSystem,
    val target: KiloEditorTarget,
) : VirtualFile() {
    override fun getName(): String = target.title

    override fun getFileSystem(): VirtualFileSystem = fs

    override fun getPath(): String = target.path

    override fun getPresentableName(): String = target.title

    override fun getPresentableUrl(): String = target.title

    override fun getFileType(): FileType = KiloFileType

    override fun isWritable(): Boolean = false

    override fun isDirectory(): Boolean = false

    override fun isValid(): Boolean = true

    override fun getParent(): VirtualFile? = null

    override fun getChildren(): Array<VirtualFile> = VirtualFile.EMPTY_ARRAY

    override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream {
        throw IOException("Kilo virtual files are read-only")
    }

    override fun contentsToByteArray(): ByteArray = ByteArray(0)

    override fun getModificationStamp(): Long = 0

    override fun getTimeStamp(): Long = 0

    override fun getLength(): Long = 0

    override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) = Unit

    override fun getInputStream(): InputStream = ByteArrayInputStream(ByteArray(0))
}
