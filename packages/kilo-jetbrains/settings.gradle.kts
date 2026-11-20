pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
        maven("https://packages.jetbrains.team/maven/p/ij/intellij-dependencies/")
    }
}

rootProject.name = "kilo.jetbrains.v2"
include("shared", "frontend", "backend")
