/**
 * Политика инвариантов.
 *
 * ВАЖНО: политика НИКОГДА не загружается из рабочей директории проекта.
 * Иначе враждебный репозиторий ослабляет собственные ограничения одним
 * коммитом — ровно тот класс атак (config injection, T3), от которого мы
 * защищаем. Источник политики — пользовательский конфиг вне workspace.
 */

export interface Policy {
  /** Пути, чтение которых запрещено агенту всегда. */
  protectedRead: string[];
  /** Пути, запись в которые запрещена даже внутри workspace. */
  protectedWrite: string[];
  /**
   * Классы артефактов, которые позже автоматически исполняются доверенным
   * инструментом вне песочницы (класс атак «отложенное исполнение»,
   * Pillar Security 2026). Запись в них — всегда решение человека.
   */
  autoExecArtifacts: string[];
  /** Хосты, на которые разрешён исходящий трафик. */
  egressAllowlist: string[];
  /** Удаления вне workspace всегда блокируются; внутри — спрашиваем при recursive. */
  askOnRecursiveDelete: boolean;
  /**
   * Каталоги-расходники: их рекурсивное удаление — повседневная работа
   * (rm -rf node_modules), вопрос здесь только раздражает.
   */
  ephemeralDirs: string[];
  /** Записи, требующие подтверждения, но не жёсткого запрета. */
  askWrite: string[];
}

export const DEFAULT_POLICY: Policy = {
  protectedRead: [
    "~/.ssh/**",
    "~/.aws/**",
    "~/.config/gh/**",
    "~/.netrc",
    "~/.npmrc",
    "~/.docker/config.json",
    "~/.kube/config",
    "**/.env",
    "**/.env.*",
    "**/*.pem",
    "**/*.key",
    "**/id_rsa",
    "**/id_ed25519",
    "**/credentials.json",
    "**/service-account*.json",
  ],
  protectedWrite: [
    "**/.git/**", // история проекта неприкосновенна
    "~/.ssh/**",
    "~/.aws/**",
    "~/.bashrc",
    "~/.zshrc",
    "~/.profile",
  ],
  autoExecArtifacts: [
    // hook-конфиги агентов и IDE
    "**/.vscode/tasks.json",
    "**/.vscode/launch.json",
    "**/.claude/settings.json",
    "**/.claude/settings.local.json",
    "**/.claude/hooks/**",
    "**/.kilocode/**",
    "**/.cursor/**",
    "**/.cursorrules",
    "**/AGENTS.md",
    "**/CLAUDE.md",
    // git-механизмы автозапуска
    "**/.git/hooks/**",
    "**/.gitconfig",
    "**/.gitattributes",
    // окружения и автозапуск оболочки
    "**/.envrc",
    "**/.venv/bin/**",
    "**/venv/bin/**",
    // Windows-раскладка venv: интерпретатор лежит в Scripts, а не в bin.
    // Без этих строк подмена python.exe проходила бы как обычная запись.
    "**/.venv/Scripts/**",
    "**/venv/Scripts/**",
    // Профиль PowerShell исполняется при каждом старте оболочки.
    "**/*profile.ps1",
    "**/Microsoft.PowerShell_profile.ps1",
    "**/pyvenv.cfg",
    "**/*.pth",
    // CI и пакетные скрипты
    "**/.github/workflows/**",
    "**/Dockerfile",
    "**/docker-compose.yml",
    "**/package.json", // postinstall/prepare-скрипты
    "**/setup.py",
    "**/conftest.py",
  ],
  egressAllowlist: [
    "registry.npmjs.org",
    "pypi.org",
    "files.pythonhosted.org",
    "github.com",
    "api.github.com",
    "codeload.github.com",
    "crates.io",
    "static.crates.io",
  ],
  askOnRecursiveDelete: true,
  ephemeralDirs: [
    "**/node_modules", "**/dist", "**/build", "**/out",
    "**/.cache", "**/coverage", "**/tmp", "**/.next", "**/target",
    "**/__pycache__", "**/.pytest_cache",
  ],
  askWrite: [
    // git config правится в обычной работе (user.email, remote) — это ask.
    // Жёсткий блок остаётся на .git/hooks и остальном содержимом .git.
    "**/.git/config",
  ],
};
