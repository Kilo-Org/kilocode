package normalization

import org.gradle.api.DefaultTask
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputFile
import org.gradle.api.tasks.PathSensitive
import org.gradle.api.tasks.PathSensitivity
import org.gradle.api.tasks.TaskAction

/**
 * Normalizes configured duplicate OpenAPI tags before openapi-generator validates the spec.
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
        write(OpenApiSpecNormalizer.normalize(raw))
    }

    private fun write(text: String) {
        spec.get().asFile.also { it.parentFile.mkdirs() }.writeText(text)
    }
}
