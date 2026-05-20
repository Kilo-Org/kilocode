import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Normalizes known upstream OpenAPI metadata before openapi-generator validates it.
 * OpenCode currently emits two top-level tags named `pty`; rename the websocket
 * tag metadata so generators that enforce unique tag names can proceed.
 */
abstract class NormalizeOpenApiSpecTask : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val input: RegularFileProperty

    @get:OutputFile
    abstract val spec: RegularFileProperty

    @TaskAction
    fun run() {
        val raw = input.get().asFile.readText()
        val root = Json.parseToJsonElement(raw) as? JsonObject
            ?: throw GradleException("OpenAPI spec root must be a JSON object.")
        val tags = root["tags"] as? JsonArray ?: return write(raw)
        val hits = tags.count(::isPtyConnectTag)
        if (hits == 0) return write(raw)
        if (hits > 1) {
            throw GradleException("Expected one upstream PTY websocket tag, found $hits.")
        }
        val fixed = JsonObject(
            root + ("tags" to JsonArray(tags.map { tag ->
                if (!isPtyConnectTag(tag)) return@map tag
                val item = tag as JsonObject
                JsonObject(item + ("name" to JsonPrimitive("pty-connect")))
            }))
        )
        val json = Json { prettyPrint = true }
            .encodeToString(JsonElement.serializer(), fixed)
        write("$json\n")
    }

    private fun isPtyConnectTag(tag: JsonElement): Boolean {
        val item = tag as? JsonObject ?: return false
        val name = (item["name"] as? JsonPrimitive)?.content
        val desc = (item["description"] as? JsonPrimitive)?.content
        return name == "pty" && desc == "PTY websocket route."
    }

    private fun write(text: String) {
        spec.get().asFile.also { it.parentFile.mkdirs() }.writeText(text)
    }
}
