---
"@kilocode/kilo-jetbrains": minor
---

Run the project's Spring Boot, Application, and Kotlin run configurations in a worktree. The worktree Build/Run popup now lists them alongside Gradle tasks and marks which build system will execute them, so a Spring Boot app runs the worktree's own code instead of reporting "No supported run configurations". Frameworks that refuse to be built by Gradle still run, as a plain application, and say which of their settings could not come along.

Stopping such a run terminates the application gracefully, and offers Kill for an application that outlives its build. Removing a worktree no longer leaves its application running.
