package ai.kilocode.client.vfs

import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.vfs.NonPhysicalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileListener
import com.intellij.openapi.vfs.VirtualFilePathWrapper
import com.intellij.openapi.vfs.VirtualFileSystem
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap
import kotlinx.serialization.json.Json

class KiloVirtualFileSystem : VirtualFileSystem(), NonPhysicalFileSystem {
    private val files = ConcurrentHashMap<KiloPath, KiloVirtualFile>()

    fun getPath(path: KiloPath): String = json.encodeToString(KiloPath.serializer(), path.canonical())

    fun findOrCreateFile(path: KiloPath): VirtualFile? {
        service<KiloVirtualFileKindRegistry>().get(path.kind) ?: return null
        return files.computeIfAbsent(path.canonical()) { KiloVirtualFile(it) }
    }

    fun release(path: KiloPath) {
        files.remove(path.canonical())
    }

    fun clear() {
        files.clear()
    }

    override fun findFileByPath(path: String): VirtualFile? {
        val parsed = decode(path) ?: return null
        return findOrCreateFile(parsed)
    }

    override fun refreshAndFindFileByPath(path: String): VirtualFile? = findFileByPath(path)

    override fun extractPresentableUrl(path: String): String {
        return (refreshAndFindFileByPath(path) as? VirtualFilePathWrapper)?.presentablePath ?: path
    }

    override fun refresh(asynchronous: Boolean) {}

    override fun getProtocol(): String = PROTOCOL

    override fun addVirtualFileListener(listener: VirtualFileListener) {}

    override fun removeVirtualFileListener(listener: VirtualFileListener) {}
    override fun isReadOnly(): Boolean = true
    override fun deleteFile(requestor: Any?, file: VirtualFile) = unsupported()
    override fun moveFile(requestor: Any?, file: VirtualFile, newParent: VirtualFile) = unsupported()
    override fun renameFile(requestor: Any?, file: VirtualFile, newName: String) = unsupported()
    override fun createChildFile(requestor: Any?, file: VirtualFile, name: String): VirtualFile = unsupported()
    override fun createChildDirectory(requestor: Any?, file: VirtualFile, name: String): VirtualFile = unsupported()
    override fun copyFile(requestor: Any?, file: VirtualFile, newParent: VirtualFile, copyName: String): VirtualFile = unsupported()

    private fun unsupported(): Nothing = throw UnsupportedOperationException("Kilo virtual files are read-only")

    companion object {
        const val PROTOCOL = "kilo"

        private val json = Json
        private val log = logger<KiloVirtualFileSystem>()
        private val local = KiloVirtualFileSystem()

        fun getInstance(): KiloVirtualFileSystem = local

        fun decode(path: String): KiloPath? {
            return try {
                val raw = raw(path) ?: return null
                json.decodeFromString(KiloPath.serializer(), raw).canonical()
            } catch (err: Exception) {
                log.warn("Cannot deserialize $path", err)
                null
            }
        }

        private fun raw(path: String): String? {
            if (path.startsWith("{")) return path
            if (!path.startsWith("$PROTOCOL://")) return null
            val raw = path.substringAfter("://")
            if (raw.startsWith("{")) return raw
            if (!raw.startsWith("%7B", ignoreCase = true)) return null
            return URLDecoder.decode(raw, StandardCharsets.UTF_8)
        }
    }
}
