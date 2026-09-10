<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  Español |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

<p align="center">
  <a href="https://kilo.ai"><img width="96" alt="Kilo Code" src="packages/kilo-vscode/assets/kilo.svg" /></a>
</p>

<p align="center">El agente de programación con IA de código abierto: Kilo sobre OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Esta rama es una versión preliminar de desarrollo, no el producto Kilo publicado ni una actualización directa de v1. Conserva la interfaz original de Kilo mientras migra el motor a v2. Usa almacenamiento separado de `kilo2`; las importaciones son explícitas. Los datos de v1 no se migran automáticamente.

---

### Instalación

Usa Bun 1.4 o posterior. Desde este repositorio, instala las dependencias y elige la CLI o VS Code. La instalación desde cero y todas las plataformas todavía no han completado la validación de lanzamiento. Los paquetes npm y las versiones del Marketplace no instalan esta rama.

```sh
bun install
```

#### CLI

Abre la CLI interactiva de Kilo. Puedes indicar un directorio de proyecto, por ejemplo `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Compila y abre la extensión original de Kilo en un perfil de desarrollo aislado de VS Code. Instala VS Code y añade `code` al PATH, o configura `VSCODE_BIN`. La extensión inicia su servidor local automáticamente. La migración de la extensión sigue incompleta.

```sh
bun run extension
```

### Agentes

**Code** implementa cambios. **Plan** investiga, cuestiona supuestos, guarda un plan y permite pasar a la implementación. **Ask** responde sin editar archivos. **Debug** investiga problemas. Se pueden configurar agentes personalizados. Las herramientas y los permisos disponibles dependen de la configuración.

### Qué hace

Hay partes implementadas de conversaciones nativas, herramientas y permisos, modelos y cuentas del Gateway, ajustes, memoria, indexación, aislamiento y terminales. Siguen pendientes la paridad completa de VS Code, JetBrains, autocompletado/FIM, voz y algunos flujos en la nube. Compartir sesiones, verificar servicios desplegados, firmar y distribuir para todas las plataformas también requieren trabajo. Tener el código no demuestra aceptación de extremo a extremo.

### Documentación

Consulta el plan de migración y los planes de pruebas para conocer el estado de esta rama. La documentación general de Kilo describe el producto publicado y puede diferir de esta versión preliminar.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Contribuir

Las contribuciones son bienvenidas. Lee la guía de contribución y las convenciones de la bifurcación v2 antes de modificar código compartido. Mantén el comportamiento de Kilo en paquetes propios cuando sea posible, verifica los paquetes afectados y conserva la atribución al proyecto original.

- [Contribuir](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licencia

[MIT](LICENSE)

### FAQ

<details>
<summary>¿De dónde viene Kilo CLI?</summary>

Kilo CLI es un fork de [OpenCode](https://github.com/anomalyco/opencode), mejorado para funcionar dentro de la plataforma de ingeniería agéntica de Kilo.

</details>
