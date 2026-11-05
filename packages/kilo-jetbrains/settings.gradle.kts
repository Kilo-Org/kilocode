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
// Each floor names the exact modules it covers and the version range it touches: a request in
// [from, to) is raised to `to`, anything outside it (older release lines, newer versions, other
// release trains such as bc-fips or netty-tcnative) is left alone, so a floor never downgrades and
// never rewrites a module onto a train it is not published on. `-alpha` requests only match floors
// that are themselves `-alpha`, so OpenTelemetry's alpha modules move in lockstep with the stable
// ones. Raise an entry when a new alert names a later patched version, and drop it once nothing
// resolves below it.
class Floor(val module: Regex, val from: String, val to: String)

val netty = "io\\.netty:netty-(buffer|codec|codec-base|codec-compression|codec-http|codec-http2|common|handler|resolver|transport|transport-native-unix-common)"
val otel = "io\\.opentelemetry:opentelemetry-[a-z0-9-]+"
val jackson = "com\\.fasterxml\\.jackson\\.core:jackson-(core|databind)"

val floors = listOf(
    Floor(Regex(netty), "4.2.0", "4.2.19.Final"),
    Floor(Regex("org\\.bouncycastle:(bcprov|bcpkix|bcutil)-jdk18on"), "1.0", "1.86"),
    Floor(Regex(jackson), "2.0.0", "2.21.8"),
    Floor(Regex(jackson), "2.22.0", "2.22.4"),
    Floor(Regex("com\\.google\\.guava:guava"), "0", "33.7.2-jre"),
    Floor(Regex("com\\.github\\.jknack:handlebars"), "0", "4.5.8"),
    Floor(Regex("org\\.jsoup:jsoup"), "0", "1.23.2"),
    Floor(Regex(otel), "1.0.0", "1.67.0"),
    Floor(Regex(otel), "1.0.0-alpha", "1.67.0-alpha"),
)

fun parts(version: String) = Regex("^(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?").find(version)
    ?.groupValues?.drop(1)?.map { it.toIntOrNull() ?: 0 }

fun order(a: List<Int>, b: List<Int>) = a.zip(b).map { compareValues(it.first, it.second) }.firstOrNull { it != 0 } ?: 0

fun floor(req: ModuleVersionSelector): String? {
    val version = req.version ?: return null
    val have = parts(version) ?: return null
    val alpha = version.endsWith("-alpha")
    return floors.firstOrNull {
        val from = parts(it.from) ?: return@firstOrNull false
        val to = parts(it.to) ?: return@firstOrNull false
        it.module.matches("${req.group}:${req.name}") && it.to.endsWith("-alpha") == alpha &&
            order(from, have) <= 0 && order(have, to) < 0
    }?.to
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
