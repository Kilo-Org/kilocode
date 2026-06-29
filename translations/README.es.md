<p align="center">
  <a href="../README.md">English</a> | <a href="README.zh.md">简体中文</a> | <a href="README.zht.md">繁體中文</a> | <a href="README.ko.md">한국어</a> | <a href="README.de.md">Deutsch</a> | Español | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.da.md">Dansk</a> | <a href="README.ja.md">日本語</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.bs.md">Bosanski</a> | <a href="README.ar.md">العربية</a> | <a href="README.no.md">Norsk</a> | <a href="README.br.md">Português (Brasil)</a> | <a href="README.th.md">ไทย</a> | <a href="README.tr.md">Türkçe</a> | <a href="README.uk.md">Українська</a> | <a href="README.bn.md">বাংলা</a> | <a href="README.gr.md">Ελληνικά</a> | <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="250" alt="Kilo Code logo" src="https://github.com/user-attachments/assets/bdb0c174-b9fd-40ad-a47b-f3aab9b54e8d" /></a>
</p>

<p align="center">El agente de programación de código abierto para construir con IA en VS Code, JetBrains o la CLI.</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code"><img src="https://raster.shields.io/badge/VS_Code_Marketplace-007ACC?style=flat&logo=visualstudiocode&logoColor=white" alt="VS Code Marketplace" height="20"></a>
  <a href="https://www.npmjs.com/package/@kilocode/cli"><img alt="npm" src="https://raster.shields.io/npm/v/@kilocode/cli?style=flat" height="20" /></a>
  <a href="https://x.com/kilocode"><img src="https://raster.shields.io/badge/kilocode-000000?style=flat&logo=x&logoColor=white" alt="X (Twitter)" height="20"></a>
  <a href="https://blog.kilo.ai"><img src="https://raster.shields.io/badge/Blog-555?style=flat&logo=substack&logoColor=white" alt="Blog" height="20"></a>
  <a href="https://kilo.ai/discord"><img src="https://raster.shields.io/badge/Join%20Discord-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord" height="20"></a>
  <a href="https://www.reddit.com/r/kilocode/"><img src="https://raster.shields.io/badge/Join%20r%2Fkilocode-D84315?style=flat&logo=reddit&logoColor=white" alt="Reddit" height="20"></a>
</p>

![Kilo-in-VS-Code-and-CLI](https://github.com/user-attachments/assets/0536ca59-ed81-4512-9e05-d186187a1b52)

---

Kilo Code es un agente de programación con IA que te acompaña en todos los lugares donde trabajas: [VS Code](https://kilo.ai/landing/vs-code), [JetBrains](https://kilo.ai/features/jetbrains-native) y la [CLI](https://kilo.ai/cli). Es de código abierto y tiene precios abiertos. Puedes elegir entre más de 500 modelos, cambiar entre ellos a mitad de una tarea y pagar la tarifa del proveedor del modelo sin recargos. No necesitas claves de API para empezar.

### Instalación

Elige dónde quieres ejecutar Kilo.

<details open>
<summary><strong>VS Code</strong></summary>

<br>

Instala directamente la [extensión Kilo Code](vscode:extension/kilocode.kilo-code), o descárgala desde [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=kilocode.Kilo-Code). Crea una cuenta y tendrás acceso a más de 500 modelos, incluidos GPT-5.5, Claude Opus 4.7, Claude Sonnet 4.6 y Gemini 3.1 Pro Preview, todos con precios del proveedor.

</details>

<details open>
<summary><strong>CLI</strong></summary>

<br>

```bash
# npm
npm install -g @kilocode/cli

# curl
curl -fsSL https://kilo.ai/cli/install | bash

# pnpm
pnpm add -g @kilocode/cli

# bun
bun add -g @kilocode/cli

# Homebrew (macOS / Linux)
brew install Kilo-Org/tap/kilo

# Arch Linux (AUR)
paru -S kilo-bin
```

Luego ejecuta `kilo` en cualquier directorio de proyecto para empezar.

</details>

<details>
<summary><strong>JetBrains</strong></summary>

<br>

Instala el [plugin Kilo Code](https://plugins.jetbrains.com/plugin/28350-kilo-code) desde JetBrains Marketplace, o busca "Kilo Code" en `Settings → Plugins` dentro de cualquier IDE de JetBrains.

</details>

<details>
<summary><strong>Cloud Agent</strong></summary>

<br>

Ejecuta Kilo desde la web, sin necesitar una máquina local, en [app.kilo.ai/cloud](https://app.kilo.ai/cloud).

</details>

<details>
<summary><strong>Revisiones de código</strong></summary>

<br>

Configura revisiones automáticas de código con IA en tus pull requests en [app.kilo.ai/code-reviews](https://app.kilo.ai/code-reviews).

</details>

<details>
<summary><strong>KiloClaw</strong></summary>

<br>

Activa tu agente de IA siempre disponible en [app.kilo.ai/claw](https://app.kilo.ai/claw).

</details>

<details>
<summary>Instalar la CLI desde GitHub Releases (binarios)</summary>

Descarga el binario más reciente desde la [página de Releases](https://github.com/Kilo-Org/kilocode/releases).

| Plataforma | Recurso |
|---|---|
| Windows (la mayoría de PCs) | `kilo-windows-x64.zip` |
| macOS (Apple Silicon) | `kilo-darwin-arm64.zip` |
| macOS (Intel) | `kilo-darwin-x64.zip` |
| Linux x64 | `kilo-linux-x64.tar.gz` |
| Linux ARM | `kilo-linux-arm64.tar.gz` |

Notas: `x64-baseline` es una compilación de compatibilidad para CPUs antiguas sin AVX. `musl` es la compilación enlazada estáticamente para Alpine o imágenes Docker mínimas sin glibc. `kilo-vscode-*.vsix` es el paquete de extensión de VS Code, no la CLI. Los archivos `Source code` son para compilar desde el código fuente.

</details>

### Agents

Kilo incluye agents especializados entre los que puedes cambiar según la tarea. También puedes crear tus propios agents personalizados.

- **Code** - El predeterminado. Implementa y edita código a partir de lenguaje natural.
- **Plan** - Diseña la arquitectura y escribe planes de implementación antes de que se escriba código.
- **Ask** - Responde preguntas sobre tu base de código sin tocar archivos.
- **Debug** - Diagnostica y rastrea problemas.
- **Review** - Revisa tus cambios y detecta problemas de rendimiento, seguridad, estilo y cobertura de pruebas.

Más información sobre [agents y agents personalizados](https://kilo.ai/docs/code-with-ai/agents/using-agents).

### Qué hace

- **Generación de código** desde lenguaje natural, en varios archivos.
- **Autocompletado en línea** con sugerencias ghost-text y Tab para aceptar.
- **Autoverificación** para que el agente revise y corrija su propio trabajo.
- **Control de terminal y navegador** para ejecutar comandos y automatizar la web.
- **Marketplace MCP** para encontrar y conectar servidores MCP que amplían lo que el agente puede hacer.
- **Más de 500 modelos** con cambio a mitad de tarea, para ajustar latencia, costo y razonamiento al trabajo.

### Modo autónomo (CI/CD)

Ejecuta `kilo run` con `--auto` para operar de forma totalmente autónoma y sin prompts, pensado para pipelines CI/CD:

```bash
kilo run --auto "run tests and fix any failures"
```

`--auto` desactiva todos los prompts de permisos y permite que el agente ejecute cualquier acción sin confirmación. Úsalo solo en entornos de confianza.

### Documentación

Para configuración y todo lo demás, consulta la [documentación](https://kilo.ai/docs).

### Contribuir

Las contribuciones de desarrolladores, escritores y cualquier persona son bienvenidas. Empieza con la [Guía de contribución](/CONTRIBUTING.md) para la configuración del entorno, los estándares de código y cómo abrir un pull request. Consulta [RELEASING.md](../RELEASING.md) para el proceso de lanzamiento de la extensión de VS Code y la CLI, y [packages/kilo-jetbrains/RELEASING.md](../packages/kilo-jetbrains/RELEASING.md) para el plugin de JetBrains.

Lee nuestro [Código de conducta](/CODE_OF_CONDUCT.md) antes de participar.

### Licencia

MIT. Puedes usar, modificar y distribuir este código, incluso comercialmente, siempre que conserves los avisos de atribución y licencia. Consulta [License](/LICENSE).

### FAQ

<details>
<summary>¿De dónde viene Kilo CLI?</summary>

Kilo CLI es un fork de [OpenCode](https://github.com/anomalyco/opencode), mejorado para funcionar dentro de la plataforma de ingeniería agéntica de Kilo.

</details>

---

**Únete a la comunidad** [Discord](https://kilo.ai/discord) | [X](https://x.com/kilocode) | [Reddit](https://www.reddit.com/r/kilocode/)
