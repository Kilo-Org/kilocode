<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  한국어 |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
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

<p align="center">오픈 소스 AI 코딩 에이전트 — OpenCode v2 기반 Kilo.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> 이 브랜치는 개발 미리 보기이며, 출시된 Kilo 제품이나 v1을 덮어쓰는 업그레이드가 아닙니다. 기존 Kilo UI를 유지하면서 런타임을 v2로 이전합니다. 별도의 `kilo2` 저장소를 사용하며 가져오기는 명시적으로 실행합니다. 기존 v1 데이터는 자동 이전되지 않습니다.

---

### 설치

Bun 1.4 이상을 사용하세요. 이 체크아웃에서 의존성을 설치한 뒤 CLI 또는 VS Code를 선택하세요. 새 의존성 설치와 모든 플랫폼의 출시 검증은 아직 완료되지 않았습니다. 공개 npm 패키지와 Marketplace 버전은 이 브랜치를 설치하지 않습니다.

```sh
bun install
```

#### CLI

Kilo 대화형 CLI를 엽니다. `bun run dev /path/to/project`처럼 프로젝트 디렉터리를 지정할 수 있습니다.

```sh
bun run dev
```

#### VS Code

기존 Kilo 확장을 빌드하고 격리된 VS Code 개발 프로필에서 엽니다. VS Code를 설치하고 `code`를 PATH에 추가하거나 `VSCODE_BIN`을 설정하세요. 확장이 로컬 서버를 자동으로 시작합니다. 확장 이전은 아직 미완료입니다.

```sh
bun run extension
```

### 에이전트

**Code**는 변경을 구현합니다. **Plan**은 조사하고 가정을 검토하며 계획을 저장한 뒤 구현으로 넘기는 선택지를 제공합니다. **Ask**는 파일을 수정하지 않고 답합니다. **Debug**는 문제를 조사합니다. 사용자 지정 에이전트도 구성할 수 있습니다. 도구와 권한은 설정에 따라 달라집니다.

### 기능

네이티브 대화, 도구와 권한, Gateway 모델·계정 통합, 설정, 메모리, 인덱싱, 샌드박스, 터미널 어댑터의 일부가 구현되었습니다. 기존 VS Code와의 완전한 동등성, JetBrains, 자동 완성/FIM, 음성 및 일부 클라우드 흐름은 아직 미완료입니다. 공유, 배포된 서비스 검증, 서명, 플랫폼별 배포도 남아 있습니다. 소스가 있다는 사실만으로 종단 간 검증을 통과한 것은 아닙니다.

### 문서

이 브랜치의 상태는 이전 계획과 테스트 계획을 확인하세요. 일반 Kilo 문서는 출시 제품을 설명하므로 이 미리 보기와 다를 수 있습니다.

- [마이그레이션 진행 상황 (#13750)](https://github.com/Kilo-Org/kilocode/issues/13750)
- [마이그레이션 추적](https://github.com/Kilo-Org/kilocode/tree/kilo-v2/migration-tracking)
  - [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
  - [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### 기여

기여를 환영합니다. 공유 코드를 변경하기 전에 기여 가이드와 v2 포크 규칙을 읽으세요. 가능한 한 Kilo 전용 패키지에 동작을 두고 관련 패키지를 검증하며 업스트림 저작자 표시를 유지하세요.

- [기여](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### 라이선스

[MIT](LICENSE)

### FAQ

<details>
<summary>Kilo CLI는 어디에서 왔나요?</summary>

Kilo CLI는 [OpenCode](https://github.com/anomalyco/opencode)의 fork이며, Kilo agentic engineering 플랫폼에서 작동하도록 강화되었습니다.

</details>
