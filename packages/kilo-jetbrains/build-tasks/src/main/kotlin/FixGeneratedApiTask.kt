import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputDirectory
import org.gradle.api.tasks.TaskAction
import java.io.File

/**
 * Post-process openapi-generator output to fix codegen bugs that produce
 * uncompilable or runtime-broken Kotlin when using kotlinx.serialization.
 *
 * Fixes applied:
 *  1. Boolean const enums — `const: true`/`false` produce broken single-value
 *     enums. Replaced with plain `kotlin.Boolean`.
 *  2. Double parentheses — `HashMap<…>()()` trailing extra `()`.
 *  3. Private Double constructor — `kotlin.Double("5000")` → `5000.0`.
 *  4. Missing @Contextual on `kotlin.Any` — kotlinx.serialization can't
 *     serialize `Any` without it.
 *  5. Nullable body in ApiClient — OkHttp's `response.body` is nullable.
 *  6. AnySerializer — registers a contextual `KSerializer<Any>` backed by
 *     `JsonElement` for dynamic JSON values.
 *  7. Empty anyOf wrappers — `anyOf` unions that generate empty classes.
 *     Replaced with `kotlinx.serialization.json.JsonElement`.
 */
abstract class FixGeneratedApiTask : DefaultTask() {
    @get:InputDirectory
    abstract val generated: DirectoryProperty

    @TaskAction
    fun run() {
        val root = generated.get().asFile
        fixEmptyWrappers(root)
        root.walkTopDown().filter { it.extension == "kt" }.forEach { fix(it) }
    }

    private fun fixEmptyWrappers(root: File) {
        val models = File(root, "ai/kilocode/jetbrains/api/model")
        if (!models.isDirectory) return

        val empty = Regex("""\nclass \w+ \(\n\n\)""")
        val wrappers = models.listFiles()
            ?.filter { it.extension == "kt" }
            ?.filter { f -> val t = f.readText(); empty.containsMatchIn(t) && !t.contains("val ") }
            ?.map { it.nameWithoutExtension }
            ?: return

        for (name in wrappers) File(models, "$name.kt").delete()

        root.walkTopDown().filter { it.extension == "kt" }.forEach { file ->
            var text = file.readText()
            var changed = false
            for (name in wrappers) {
                if (!text.contains(name)) continue
                text = text.replace(Regex("""import [^\n]*\.$name\n"""), "")
                text = text.replace(Regex("""\b$name\b"""), "kotlinx.serialization.json.JsonElement")
                changed = true
            }
            if (changed) file.writeText(text)
        }
    }

    private fun fix(file: File) {
        var text = file.readText()
        var changed = false

        // Fix 1: boolean const enums
        val decl = Regex("""enum class (\w+)\(val value: kotlin\.Boolean\)""")
        for (name in decl.findAll(text).map { it.groupValues[1] }.toList()) {
            text = text.replace(Regex("""(val \w+:\s*)\w+\.$name""")) { m ->
                "${m.groupValues[1]}kotlin.Boolean"
            }
            text = text.replace(Regex(
                """\n\s*@Serializable\s*\n\s*enum class $name\(val value: kotlin\.Boolean\)\s*\{[^}]*\}"""
            ), "")
            text = text.replace(Regex(
                """\n\s*/\*\*\s*\n(\s*\*[^\n]*\n)*\s*\*/\s*(?=\n\s*\n)"""
            ), "")
            changed = true
        }

        // Fix 2: double parentheses `HashMap<…>()()`
        if (text.contains("()()")) {
            text = text.replace("()()", "()")
            changed = true
        }

        // Fix 3: `kotlin.Double("…")` → double literal
        val ctor = Regex("""kotlin\.Double\("(\d+(?:\.\d+)?)"\)""")
        if (ctor.containsMatchIn(text)) {
            text = ctor.replace(text) { m ->
                val n = m.groupValues[1]
                if (n.contains(".")) n else "$n.0"
            }
            changed = true
        }

        // Fix 4: @Contextual on bare kotlin.Any
        if (text.contains("kotlin.Any") &&
            text.contains("import kotlinx.serialization.Contextual") &&
            text.contains("@Serializable") &&
            text.contains("data class")
        ) {
            text = text.replace(
                Regex("""(?<!@Contextual )kotlin\.Any"""),
                "@Contextual kotlin.Any"
            )
            changed = true
        }

        // Fix 5: nullable body in ApiClient
        if (file.name == "ApiClient.kt") {
            val guard = "val body = response.body"
            if (text.contains(guard) && !text.contains("if (body == null) return null")) {
                text = text.replace(guard, "$guard\n        if (body == null) return null")
                text = text.replace("body?.", "body.")
                changed = true
            }
            if (text.contains("it.body.string()")) {
                text = text.replace("it.body.string()", "it.body?.string()")
                changed = true
            }
        }

        // Fix 6: AnySerializer in Serializer.kt
        if (file.name == "Serializer.kt" && !text.contains("AnySerializer")) {
            text = text.replace(
                "import kotlinx.serialization.modules.SerializersModuleBuilder",
                "import kotlinx.serialization.modules.SerializersModuleBuilder\n" +
                "import kotlinx.serialization.KSerializer\n" +
                "import kotlinx.serialization.descriptors.SerialDescriptor\n" +
                "import kotlinx.serialization.encoding.Decoder\n" +
                "import kotlinx.serialization.encoding.Encoder\n" +
                "import kotlinx.serialization.json.JsonDecoder\n" +
                "import kotlinx.serialization.json.JsonEncoder\n" +
                "import kotlinx.serialization.json.JsonElement"
            )
            text = text.replace(
                "contextual(StringBuilder::class, StringBuilderAdapter)",
                "contextual(StringBuilder::class, StringBuilderAdapter)\n" +
                "            contextual(Any::class, AnySerializer)"
            )
            text = text.trimEnd() + "\n\n" +
                "internal object AnySerializer : KSerializer<Any> {\n" +
                "    private val delegate = JsonElement.serializer()\n" +
                "    override val descriptor: SerialDescriptor = delegate.descriptor\n" +
                "    override fun serialize(encoder: Encoder, value: Any) {\n" +
                "        val json = (encoder as JsonEncoder).json\n" +
                "        encoder.encodeSerializableValue(delegate, json.encodeToJsonElement(delegate, value as? JsonElement ?: return))\n" +
                "    }\n" +
                "    override fun deserialize(decoder: Decoder): Any {\n" +
                "        return (decoder as JsonDecoder).decodeJsonElement()\n" +
                "    }\n" +
                "}\n"
            changed = true
        }

        if (changed) file.writeText(text)
    }
}
