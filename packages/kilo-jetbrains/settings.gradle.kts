rootProject.name = "kilo.jetbrains"

include("shared")
include("frontend")
include("backend")

pluginManagement {
    includeBuild("build-tasks")
    repositories {
        mavenCentral()
        gradlePluginPortal()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/")
    }
}

// Security floors for transitive dependencies of build tooling and test frameworks: the Gradle
// plugins (IntelliJ Platform, openapi-generator), the IntelliJ test framework and the ide-starter
// UI e2e driver. None of them ship in the plugin, but dependency-submission.yml submits the whole
// Gradle graph, so Dependabot alerts on them and never opens PRs for transitive ones.
//
// A floor only raises a version: a request below the first listed floor whose major.minor line is
// at or above its own moves up to that floor (so jackson 2.19.0 goes to 2.21.8, 2.22.1 to 2.22.4,
// guava 32.1.3 to 33.7.2); anything newer is left alone. Group-wide entries only touch modules on
// the floor's major, because a group can hold modules with their own scheme (netty-tcnative is
// 2.x). Raise an entry when a new alert names a later patched version, and drop it once nothing
// resolves below it.
val floors = mapOf(
    "io.netty" to listOf("4.2.19.Final"),
    "org.bouncycastle" to listOf("1.86"),
    "com.fasterxml.jackson.core:jackson-core" to listOf("2.21.8", "2.22.4"),
    "com.fasterxml.jackson.core:jackson-databind" to listOf("2.21.8", "2.22.4"),
    "com.google.guava:guava" to listOf("33.7.2-jre"),
    "com.github.jknack:handlebars" to listOf("4.5.8"),
    "org.jsoup:jsoup" to listOf("1.23.2"),
    "io.opentelemetry" to listOf("1.67.0"),
)

fun parts(version: String) = Regex("^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?").find(version)
    ?.groupValues?.drop(1)?.map { it.toIntOrNull() ?: 0 }

fun order(a: List<Int>, b: List<Int>) = a.zip(b).map { compareValues(it.first, it.second) }.firstOrNull { it != 0 } ?: 0

fun floor(req: ModuleVersionSelector): String? {
    val module = floors["${req.group}:${req.name}"]
    val list = module ?: floors[req.group] ?: return null
    val version = req.version ?: return null
    // OpenTelemetry's -alpha modules are versioned separately from the stable ones.
    if (version.contains("alpha")) return null
    val have = parts(version) ?: return null
    val pick = list.firstOrNull {
        val want = parts(it) ?: return@firstOrNull false
        (module != null || want[0] == have[0]) && order(want.take(2), have.take(2)) >= 0
    } ?: return null
    return pick.takeIf { order(parts(it) ?: return@takeIf false, have) > 0 }
}

gradle.beforeProject {
    val rule = Action<Configuration> {
        resolutionStrategy.eachDependency {
            // org.lz4 is abandoned with unfixed advisories; its maintained fork declares the
            // org.lz4:lz4-java capability and keeps the same net.jpountz API.
            if (requested.group == "org.lz4" && requested.name == "lz4-java") {
                useTarget("at.yawk.lz4:lz4-java:1.12.1")
                because("security: org.lz4 is unmaintained, use the at.yawk.lz4 fork")
                return@eachDependency
            }
            val version = floor(requested) ?: return@eachDependency
            useVersion(version)
            because("security floor in settings.gradle.kts")
        }
    }
    buildscript.configurations.configureEach(rule)
    configurations.configureEach(rule)
}
