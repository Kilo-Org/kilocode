package ai.kilocode.client.fs

import com.intellij.openapi.vfs.VirtualFileManager

sealed class KiloEditorTarget(
    val path: String,
    val title: String,
) {
    data object Profile : KiloEditorTarget("profile", "Kilo Profile")

    val url: String get() = VirtualFileManager.constructUrl(KiloVirtualFileSystem.PROTOCOL, path)

    companion object {
        fun parse(path: String): KiloEditorTarget? {
            val normalized = path.trim('/')
            if (normalized == Profile.path) return Profile
            return null
        }
    }
}
