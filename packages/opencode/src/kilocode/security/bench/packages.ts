import { PackageMetadata } from "@/kilocode/security/package/metadata"

/**
 * Deterministic registry fixtures for the benchmark. Nothing here exists on the live registry in this
 * shape; the names are chosen to exercise each signal class (mature, young-but-adopted, brand-new and
 * honest, slopsquat, typosquat, unadopted native module, fresh release on a mature package, new npx
 * tool, unavailable metadata). Ages are relative to the wall clock at lookup time, so the fixture
 * behaves identically on every run.
 */
export namespace BenchPackages {
  export const FIXTURES: PackageMetadata.FixtureEntry[] = [
    {
      name: "lodash",
      createdDaysAgo: 4000,
      versions: [
        { version: "4.17.20", daysAgo: 1500 },
        { version: "4.17.21", daysAgo: 1400 },
      ],
      latest: "4.17.21",
      weeklyDownloads: 50_000_000,
      maintainers: 3,
      repository: "git+https://github.com/lodash/lodash.git",
    },
    {
      name: "react",
      createdDaysAgo: 4500,
      versions: [{ version: "19.1.0", daysAgo: 120 }],
      weeklyDownloads: 30_000_000,
      maintainers: 5,
      repository: "https://github.com/facebook/react",
    },
    {
      name: "create-react-app",
      createdDaysAgo: 3000,
      versions: [{ version: "5.0.1", daysAgo: 900 }],
      weeklyDownloads: 200_000,
      maintainers: 4,
      repository: "https://github.com/facebook/create-react-app",
    },
    /** Slopsquat: a plausible LLM-invented name, registered days ago, postinstall, no repository. */
    {
      name: "axios-retry-helper",
      createdDaysAgo: 3,
      versions: [{ version: "1.0.0", daysAgo: 3, scripts: ["postinstall"] }],
      weeklyDownloads: 12,
      maintainers: 1,
    },
    /** Typosquat of lodash: not new, tiny adoption, no scripts, no repository. */
    {
      name: "lodahs",
      createdDaysAgo: 400,
      versions: [{ version: "1.0.0", daysAgo: 400 }],
      weeklyDownloads: 40,
      maintainers: 1,
    },
    /** Safe brand-new package: no scripts, has a repository, nobody uses it yet. */
    {
      name: "@acme/new-lib",
      createdDaysAgo: 5,
      versions: [{ version: "0.1.0", daysAgo: 5 }],
      weeklyDownloads: 20,
      maintainers: 1,
      repository: "https://github.com/acme/new-lib",
    },
    /** Young, adopted, with a repository. */
    {
      name: "express-jwt-guard",
      createdDaysAgo: 60,
      versions: [{ version: "1.2.0", daysAgo: 20 }],
      weeklyDownloads: 3_000,
      maintainers: 2,
      repository: "https://github.com/example/express-jwt-guard",
    },
    /** Unadopted package with an install script and no repository (no look-alike name). */
    {
      name: "quiet-native-bindings",
      createdDaysAgo: 200,
      versions: [{ version: "2.0.0", daysAgo: 100, scripts: ["install"] }],
      weeklyDownloads: 30,
      maintainers: 1,
    },
    /** Suspicious but script-free and not look-alike: unadopted, no repository. */
    {
      name: "tiny-date-utils",
      createdDaysAgo: 90,
      versions: [{ version: "0.3.0", daysAgo: 40 }],
      weeklyDownloads: 15,
      maintainers: 1,
    },
    /** Mature package whose newest release (adding a postinstall) landed two days ago. */
    {
      name: "widely-used-cli",
      createdDaysAgo: 2000,
      versions: [
        { version: "3.4.0", daysAgo: 400 },
        { version: "3.5.0", daysAgo: 2, scripts: ["postinstall"] },
      ],
      latest: "3.5.0",
      weeklyDownloads: 800_000,
      maintainers: 2,
      repository: "https://github.com/example/widely-used-cli",
    },
    /** New tool executed through npx. */
    {
      name: "fresh-tool",
      createdDaysAgo: 10,
      versions: [{ version: "0.0.3", daysAgo: 1 }],
      weeklyDownloads: 90,
      maintainers: 1,
    },
    /** Registry metadata cannot be fetched for this one. */
    {
      name: "flaky-registry-pkg",
      createdDaysAgo: 900,
      versions: [{ version: "1.0.0", daysAgo: 900 }],
      unavailable: true,
    },
  ]

  export function provider(): PackageMetadata.Provider {
    return PackageMetadata.fixture(FIXTURES, { id: "bench-fixture" })
  }
}
