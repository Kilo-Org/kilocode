import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { checkPackage, normalizePackageName, damerauLevenshtein } from "../src/packages.js";
import { guardWithPackageGate } from "../src/guard.js";
import type { RegistryClient, PackageEvidence } from "../src/registry.js";
import type { Ecosystem } from "../src/effects.js";

/** Фейковый реестр: тесты не должны зависеть от сети. */
class FakeRegistry implements RegistryClient {
  constructor(private readonly db: Record<string, PackageEvidence | null>) {}
  async lookup(_eco: Ecosystem, name: string): Promise<PackageEvidence | null> {
    if (!(name in this.db)) {
      return { exists: false, ageDays: null, weeklyDownloads: null, hasInstallScripts: null };
    }
    return this.db[name];
  }
}

const established: PackageEvidence = {
  exists: true, ageDays: 3000, weeklyDownloads: 40_000_000, hasInstallScripts: false,
};

describe("slopsquatting: галлюцинированные имена", () => {
  test("несуществующий пакет блокируется", async () => {
    const r = await checkPackage("npm", "react-super-hooks-v3", new FakeRegistry({}));
    assert.equal(r.decision, "block");
    assert.deepEqual(r.signals, ["NOT_IN_REGISTRY"]);
  });

  test("пакет, зарегистрированный на днях, требует человека", async () => {
    const reg = new FakeRegistry({
      "fancy-logger-pro": { exists: true, ageDays: 3, weeklyDownloads: 40, hasInstallScripts: false },
    });
    const r = await checkPackage("npm", "fancy-logger-pro", reg);
    assert.notEqual(r.decision, "allow");
    assert.ok(r.signals.includes("NEWBORN_PACKAGE"));
    assert.ok(r.signals.includes("LOW_ADOPTION"));
  });
});

describe("typosquatting", () => {
  test("опечатка в популярном имени блокируется", async () => {
    const reg = new FakeRegistry({
      lodahs: { exists: true, ageDays: 10, weeklyDownloads: 12, hasInstallScripts: true },
    });
    const r = await checkPackage("npm", "lodahs", reg);
    assert.equal(r.decision, "block");
    assert.ok(r.signals.includes("TYPOSQUAT_SUSPECT"));
    assert.equal(r.nearest, "lodash");
  });

  test("перестановка соседних букв ловится", async () => {
    const reg = new FakeRegistry({
      reqeusts: { exists: true, ageDays: 5, weeklyDownloads: 3, hasInstallScripts: false },
    });
    const r = await checkPackage("pypi", "reqeusts", reg);
    assert.equal(r.decision, "block");
    assert.equal(r.nearest, "requests");
  });

  test("легитимный preact не путается с react (проверка на FP)", async () => {
    const reg = new FakeRegistry({ preact: established });
    const r = await checkPackage("npm", "preact", reg);
    assert.equal(r.decision, "allow");
    assert.deepEqual(r.signals, []);
  });
});

describe("обычная работа не ломается", () => {
  test("зрелый популярный пакет проходит без вопросов", async () => {
    const reg = new FakeRegistry({ express: established });
    const r = await checkPackage("npm", "express", reg);
    assert.equal(r.decision, "allow");
  });

  test("install-скрипты поднимают вопрос, но не блокируют", async () => {
    const reg = new FakeRegistry({
      "some-native-lib": { exists: true, ageDays: 2000, weeklyDownloads: 500_000, hasInstallScripts: true },
    });
    const r = await checkPackage("npm", "some-native-lib", reg);
    assert.equal(r.decision, "ask");
    assert.deepEqual(r.signals, ["INSTALL_SCRIPTS"]);
  });
});

describe("отказ реестра не превращается в разрешение", () => {
  test("недоступный реестр → ask, не allow", async () => {
    const reg: RegistryClient = { async lookup() { return null; } };
    const r = await checkPackage("npm", "some-unknown-lib", reg);
    assert.equal(r.decision, "ask");
    assert.deepEqual(r.signals, ["REGISTRY_UNAVAILABLE"]);
  });

  test("для популярного пакета офлайн-работа не блокируется", async () => {
    const reg: RegistryClient = { async lookup() { return null; } };
    const r = await checkPackage("npm", "express", reg);
    assert.equal(r.decision, "allow");
  });
});

describe("нормализация имени", () => {
  test("scope сохраняется, версия отрезается", () => {
    assert.equal(normalizePackageName("@types/node@20.1.0"), "@types/node");
    assert.equal(normalizePackageName("express@^4.18"), "express");
    assert.equal(normalizePackageName("requests==2.31.0"), "requests");
    assert.equal(normalizePackageName("Django>=4.0"), "django");
    assert.equal(normalizePackageName("uvicorn[standard]"), "uvicorn");
  });
});

describe("дистанция", () => {
  test("транспозиция стоит одну правку", () => {
    assert.equal(damerauLevenshtein("reqeusts", "requests"), 1);
  });
  test("ранний выход не портит результат в пределах порога", () => {
    assert.equal(damerauLevenshtein("lodahs", "lodash", 2), 1);
    assert.ok(damerauLevenshtein("completely-different", "react", 2) > 2);
  });
});

describe("интеграция с нормализатором команд", () => {
  test("scoped-пакет доходит до гейта неискажённым", async () => {
    const { normalizeCommand } = await import("../src/normalize.js");
    const ctx = { workspace: "/w", home: "/h", cwd: "/w" };
    const effects = normalizeCommand({ command: "npm install @types/node@20 express", ctx });
    const names = effects.filter((e) => e.kind === "pkg_install").map((e: any) => e.name);
    assert.deepEqual(names, ["@types/node", "express"]);
  });
});


/**
 * Сцепка guard() с package gate.
 *
 * Находка фазы 3: сам по себе guard() выдаёт PACKAGE_GATE_REQUIRED → ask на
 * ЛЮБУЮ установку, включая зрелый популярный пакет. Продуктовый ориентир —
 * вопросы человеку не чаще 10% действий, поэтому предварительный ask должен
 * заменяться реальным решением гейта.
 */
describe("guard + package gate", () => {
  const ctx = { workspace: "/w", home: "/h", cwd: "/w" };
  const reg = new FakeRegistry({
    express: established,
    tsc: established,
    lodahs: { exists: true, ageDays: 10, weeklyDownloads: 12, hasInstallScripts: true },
  });

  test("зрелый пакет больше не дёргает человека", async () => {
    const r = await guardWithPackageGate({ command: "npm install express", ctx }, reg);
    assert.equal(r.decision, "allow");
    assert.deepEqual(r.recovery.rules, []);
  });

  test("npx зрелого инструмента проходит молча — трение снято", async () => {
    const r = await guardWithPackageGate({ command: "npx tsc --noEmit", ctx }, reg);
    assert.equal(r.decision, "allow");
  });

  test("опечатка в популярном имени доходит до блока через сцепку", async () => {
    const r = await guardWithPackageGate({ command: "npm install lodahs", ctx }, reg);
    assert.equal(r.decision, "block");
    assert.deepEqual(r.recovery.rules, ["PACKAGE_GATE_REQUIRED"]);
    assert.equal(r.recovery.retry_allowed, false);
  });

  test("галлюцинированное имя блокируется", async () => {
    const r = await guardWithPackageGate({ command: "npm install react-super-hooks-v3", ctx }, reg);
    assert.equal(r.decision, "block");
  });

  test("сцепка НЕ ослабляет остальные правила", async () => {
    const r = await guardWithPackageGate(
      { command: "npm install express && cat ~/.ssh/id_rsa", ctx },
      reg,
    );
    assert.equal(r.decision, "block");
    assert.ok(r.recovery.rules.includes("CREDENTIAL_READ"));
  });

  test("недоступный реестр остаётся ask, а не allow", async () => {
    const offline = { async lookup() { return null; } };
    const r = await guardWithPackageGate({ command: "npm install some-unknown-lib", ctx }, offline);
    assert.equal(r.decision, "ask");
  });

  test("команда без установки идёт мимо гейта без изменений", async () => {
    const r = await guardWithPackageGate({ command: "cat src/index.ts", ctx }, reg);
    assert.equal(r.decision, "allow");
    assert.deepEqual(r.effects, [{ kind: "fs_read", path: "/w/src/index.ts" }]);
  });

  test("в ответ агенту уходят только имена сигналов, без текста из сети", async () => {
    const r = await guardWithPackageGate({ command: "npm install lodahs", ctx }, reg);
    assert.ok(r.recovery.details.length > 0);
    for (const d of r.recovery.details) {
      assert.ok(!d.includes(String.fromCharCode(10)), "перевода строки быть не должно");
      assert.ok(!d.includes(String.fromCharCode(13)), "возврата каретки быть не должно");
      assert.ok(d.startsWith("pkg_install:npm/lodahs"), d);
      assert.ok(d.includes("TYPOSQUAT_SUSPECT"), d);
      assert.ok(d.includes("nearest=lodash"), d);
    }
  });
});
