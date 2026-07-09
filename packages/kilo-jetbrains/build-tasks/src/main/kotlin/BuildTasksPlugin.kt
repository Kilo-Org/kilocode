import normalization.NormalizeOpenApiSpecTask
import org.gradle.api.Plugin
import org.gradle.api.Project

/**
 * Empty plugin entry point required by the `gradlePlugin {}` DSL so that
 * `id("build-tasks")` resolves in `backend/build.gradle.kts`.
 *
 * The real value lives in the custom task classes this composite build
 * provides: [NormalizeOpenApiSpecTask], [FixGeneratedApiTask], and
 * [GenerateOpenApiSpecTask].
 */
class BuildTasksPlugin : Plugin<Project> {
    override fun apply(target: Project) {}
}
