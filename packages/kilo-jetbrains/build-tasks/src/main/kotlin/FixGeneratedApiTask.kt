import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.OutputDirectory
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
 *  9. AnyOf union wrappers — `anyOf` unions like `boolean | object` that
 *     generate paired `Foo` + `FooAnyOf` classes the generator can't flatten.
 *     Replaced with `kotlinx.serialization.json.JsonElement`.
 */
abstract class FixGeneratedApiTask : DefaultTask() {
    @get:OutputDirectory
    abstract val generated: DirectoryProperty

    @TaskAction
    fun run() {
        val root = generated.get().asFile
        fixEmptyWrappers(root)
        fixAnyOfUnionWrappers(root)
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

    /**
     * Fix 9: anyOf union wrappers — the generator creates paired `Foo` and
     * `FooAnyOf` data classes for `anyOf` unions like `boolean | object`.
     * When both classes have identical fields it means the generator couldn't
     * flatten the union; neither class can represent all JSON forms, so replace
     * them with `kotlinx.serialization.json.JsonElement`.
     */
    private fun fixAnyOfUnionWrappers(root: File) {
        val models = File(root, "ai/kilocode/jetbrains/api/model")
        if (!models.isDirectory) return

        val files = models.listFiles()?.filter { it.extension == "kt" } ?: return
        val byName = files.associateBy { it.nameWithoutExtension }

        val field = Regex("""\bval\s+`?(\w+)`?\s*:""")
        fun fields(file: File): Set<String> =
            field.findAll(file.readText()).map { it.groupValues[1] }.toSet()

        // Collect wrapper pairs where Foo and FooAnyOf have identical fields —
        // a sign the generator duplicated one anyOf variant as a wrapper.
        val wrappers = mutableListOf<String>()
        for ((name, file) in byName) {
            if (!name.endsWith("AnyOf")) continue
            val parent = name.removeSuffix("AnyOf")
            val parentFile = byName[parent] ?: continue
            if (fields(file) == fields(parentFile)) {
                wrappers.add(name)
                wrappers.add(parent)
            }
        }
        if (wrappers.isEmpty()) return

        // Sort longest-first so replacements don't collide (e.g. FooAnyOf before Foo).
        wrappers.sortByDescending { it.length }

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

        // Fix 6: Lenient JSON — tolerate missing fields and absent nulls so the
        // generated models survive API responses with optional fields the spec
        // marks as required. `coerceInputValues` maps type mismatches to
        // defaults; `explicitNulls = false` allows omitted nullable fields.
        if (file.name == "Serializer.kt") {
            if (!text.contains("coerceInputValues")) {
                text = text.replace(
                    "ignoreUnknownKeys = true",
                    "ignoreUnknownKeys = true\n            coerceInputValues = true\n            explicitNulls = false"
                )
                changed = true
            }
        }

        // Fix 7: Default values for non-nullable primitives in model data classes.
        // The CLI API may omit fields that the OpenAPI spec marks as required
        // (e.g. `attachment`, `reasoning` on dynamically added models).
        // Add Kotlin defaults so kotlinx.serialization doesn't throw
        // MissingFieldException.
        if (text.contains("data class") && text.contains("@Serializable")) {
            // Pattern: `val foo: kotlin.Boolean,` or `val foo: kotlin.Boolean\n`
            // (without ` = ` before the comma/newline, which would mean a default exists)
            val primitiveDefaults = listOf(
                Regex("""(val \w+:\s*kotlin\.Boolean)(,|\n)""") to { m: MatchResult ->
                    "${m.groupValues[1]} = false${m.groupValues[2]}"
                },
                Regex("""(val \w+:\s*kotlin\.Int)(,|\n)""") to { m: MatchResult ->
                    "${m.groupValues[1]} = 0${m.groupValues[2]}"
                },
                Regex("""(val \w+:\s*kotlin\.Double)(,|\n)""") to { m: MatchResult ->
                    "${m.groupValues[1]} = 0.0${m.groupValues[2]}"
                },
                Regex("""(val \w+:\s*kotlin\.String)(,|\n)""") to { m: MatchResult ->
                    "${m.groupValues[1]} = \"\"${m.groupValues[2]}"
                },
            )
            for ((pattern, transform) in primitiveDefaults) {
                if (pattern.containsMatchIn(text)) {
                    text = pattern.replace(text, transform)
                    changed = true
                }
            }
        }

        // Fix 8: AnySerializer in Serializer.kt
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
