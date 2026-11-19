package ai.kilocode.backend.migration

import com.intellij.openapi.application.PathManager
import java.io.File

class LegacyV5Sources(
    private val home: File = File(System.getProperty("user.home")),
    private val config: File = PathManager.getConfigDir().toFile(),
    private val log: ((String) -> Unit)? = null,
) {
    constructor(home: File, config: File) : this(home, config, null)

    private val root = File(home, ".kilocode")
    private val storage = File(root, "globalStorage")
    private val scoped = File(storage, "kilo code.kilo-code")

    fun secretsJson(): String? = File(root, "secrets.json").text("secrets")
    fun globalStateXml(): String? = File(config, "options/kilocode-extension-storage.xml").text("globalStateXml")
    fun mcpSettingsFile(): String? = firstFile("mcpSettings", "settings/mcp_settings.json")?.read("mcpSettings")
    fun customModesFile(): String? = firstFile("customModes", "settings/custom_modes.yaml")?.read("customModes")
    fun taskConversationFile(id: String): String? = taskFile(id, "api_conversation_history.json")?.read("taskConversation id=$id")
    fun hasTaskConversationFile(id: String): Boolean = taskFile(id, "api_conversation_history.json") != null
    fun uiMessagesFile(id: String): String? = taskFile(id, "ui_messages.json")?.read("uiMessages id=$id")

    fun taskDirIds(): List<String> {
        return taskRoots().flatMap { dir ->
            log?.invoke("Legacy v5 import: scanning task directory file=${dir.absolutePath}")
            val ids = dir.listFiles()
                ?.filter { it.isDirectory }
                ?.map { it.name }
                .orEmpty()
            log?.invoke("Legacy v5 import: scanned task directory file=${dir.absolutePath} count=${ids.size}")
            ids
        }.distinct()
    }

    fun anyPresent(): Boolean =
        File(root, "secrets.json").isFile ||
            File(storage, "settings/mcp_settings.json").isFile ||
            File(scoped, "settings/mcp_settings.json").isFile ||
            File(storage, "settings/custom_modes.yaml").isFile ||
            File(scoped, "settings/custom_modes.yaml").isFile ||
            taskRoots().any { it.isDirectory } ||
            globalStateXml()?.contains("ExtensionStorageService") == true

    private fun firstFile(label: String, path: String): File? {
        val candidates = listOf(File(storage, path), File(scoped, path))
        return candidates.firstOrNull { it.isFile } ?: candidates.first().also {
            log?.invoke("Legacy v5 import: missing $label file=${candidates.joinToString(",") { file -> file.absolutePath }}")
        }.takeIf { false }
    }

    private fun taskFile(id: String, name: String): File? = taskRoots()
        .map { File(it, "$id/$name") }
        .firstOrNull { it.isFile }
        ?: File(taskRoots().first(), "$id/$name").also {
            log?.invoke("Legacy v5 import: missing $name id=$id file=${taskRoots().joinToString(",") { dir -> File(dir, "$id/$name").absolutePath }}")
        }.takeIf { false }

    private fun taskRoots() = listOf(File(storage, "tasks"), File(scoped, "tasks"))

    private fun File.read(label: String): String? = runCatching {
        log?.invoke("Legacy v5 import: reading $label file=${absolutePath}")
        readText()
    }.getOrNull()

    private fun File.text(label: String): String? = runCatching {
        if (!isFile) {
            log?.invoke("Legacy v5 import: missing $label file=${absolutePath}")
            return@runCatching null
        }
        log?.invoke("Legacy v5 import: reading $label file=${absolutePath}")
        readText()
    }.getOrNull()
}
