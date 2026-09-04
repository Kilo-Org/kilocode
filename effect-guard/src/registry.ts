import type { Ecosystem } from "./effects.js";

/**
 * Доступ к публичным реестрам пакетов.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО МОДУЛЯ: ответ реестра — НЕДОВЕРЕННЫЕ данные.
 * README, description и maintainer-поля пакета контролирует тот, кто его
 * опубликовал, то есть потенциальный атакующий. Поэтому наружу отсюда
 * выходят только числа, даты и булевы флаги — никакого текста, который мог
 * бы попасть в контекст агента и стать инъекцией.
 *
 * Единственная строка, которую мы возвращаем, — имя ближайшего популярного
 * пакета, и оно берётся из НАШЕГО локального списка, а не из ответа сети.
 */

export interface PackageEvidence {
  /** Пакет вообще существует в реестре. */
  exists: boolean;
  /** Возраст первой публикации в днях; null, если реестр не сообщил. */
  ageDays: number | null;
  /** Загрузки за неделю; null, если метрика недоступна. */
  weeklyDownloads: number | null;
  /** Есть ли install/postinstall-скрипты (исполнение кода при установке). */
  hasInstallScripts: boolean | null;
}

export interface RegistryClient {
  lookup(ecosystem: Ecosystem, name: string): Promise<PackageEvidence | null>;
}

const DAY_MS = 86_400_000;

/** Боевая реализация. Таймаут обязателен: гейт не должен вешать работу агента. */
export class HttpRegistryClient implements RegistryClient {
  constructor(private readonly timeoutMs = 3000) {}

  async lookup(ecosystem: Ecosystem, name: string): Promise<PackageEvidence | null> {
    try {
      if (ecosystem === "npm") return await this.npm(name);
      if (ecosystem === "pypi") return await this.pypi(name);
      return null;
    } catch {
      // Сеть недоступна / таймаут → null. Решение о вердикте принимает гейт:
      // отсутствие данных превращается в `ask`, но никогда в `allow`.
      return null;
    }
  }

  private async fetchJson(url: string): Promise<any | null> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (res.status === 404) return { __notFound: true };
      if (!res.ok) return null;
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async npm(name: string): Promise<PackageEvidence | null> {
    const meta = await this.fetchJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!meta) return null;
    if (meta.__notFound) return { exists: false, ageDays: null, weeklyDownloads: null, hasInstallScripts: null };

    const created = meta?.time?.created ? Date.parse(meta.time.created) : NaN;
    const latestTag = meta?.["dist-tags"]?.latest;
    const latest = latestTag ? meta?.versions?.[latestTag] : undefined;
    const scripts = latest?.scripts ?? {};

    const dl = await this.fetchJson(
      `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
    );

    return {
      exists: true,
      ageDays: Number.isNaN(created) ? null : Math.floor((Date.now() - created) / DAY_MS),
      weeklyDownloads: typeof dl?.downloads === "number" ? dl.downloads : null,
      hasInstallScripts: Boolean(scripts.preinstall || scripts.install || scripts.postinstall),
    };
  }

  private async pypi(name: string): Promise<PackageEvidence | null> {
    const meta = await this.fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!meta) return null;
    if (meta.__notFound) return { exists: false, ageDays: null, weeklyDownloads: null, hasInstallScripts: null };

    const uploads: number[] = [];
    for (const files of Object.values<any>(meta?.releases ?? {})) {
      for (const f of files ?? []) {
        const t = Date.parse(f?.upload_time_iso_8601 ?? f?.upload_time ?? "");
        if (!Number.isNaN(t)) uploads.push(t);
      }
    }
    const first = uploads.length ? Math.min(...uploads) : NaN;

    return {
      exists: true,
      ageDays: Number.isNaN(first) ? null : Math.floor((Date.now() - first) / DAY_MS),
      weeklyDownloads: null, // PyPI не отдаёт загрузки в этом эндпоинте
      hasInstallScripts: null, // определяется только распаковкой sdist — вне MVP
    };
  }
}
