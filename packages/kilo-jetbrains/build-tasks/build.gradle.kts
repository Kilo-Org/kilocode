plugins {
    `kotlin-dsl`
}

repositories {
    mavenCentral()
}

gradlePlugin {
    plugins {
        create("build-tasks") {
            id = "build-tasks"
            implementationClass = "BuildTasksPlugin"
        }
    }
}
