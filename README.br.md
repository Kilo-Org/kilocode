<!-- kilocode_change - Kilo v1 README adapted for this v2 development branch; root locale paths retained. -->
<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
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
  Português (Brasil) |
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

<p align="center">O agente de programação com IA de código aberto — Kilo sobre OpenCode v2.</p>

<p align="center">
  <a href="https://kilo.ai">Kilo</a> ·
  <a href="https://kilo.ai/discord">Discord</a> ·
  <a href="https://x.com/kilocode">X</a> ·
  <a href="https://www.reddit.com/r/kilocode/">Reddit</a>
</p>

> [!IMPORTANT]
> Esta branch é uma prévia de desenvolvimento, não o produto Kilo publicado nem uma atualização direta da v1. Ela preserva a interface original do Kilo enquanto migra o runtime para v2. Usa armazenamento separado de `kilo2`; as importações são explícitas. Os dados da v1 não são migrados automaticamente.

---

### Instalação

Use Bun 1.4 ou mais recente. Instale as dependências neste checkout e escolha a CLI ou o VS Code. A instalação do zero e todas as plataformas ainda não concluíram a validação de lançamento. Os pacotes npm e as versões do Marketplace não instalam esta branch.

```sh
bun install
```

#### CLI

Abra a CLI interativa do Kilo. Você pode indicar uma pasta de projeto, por exemplo `bun run dev /path/to/project`.

```sh
bun run dev
```

#### VS Code

Compile e abra a extensão original do Kilo em um perfil de desenvolvimento isolado do VS Code. Instale o VS Code e coloque `code` no PATH, ou defina `VSCODE_BIN`. A extensão inicia o servidor local automaticamente. A migração da extensão ainda está incompleta.

```sh
bun run extension
```

### Agentes

**Code** implementa alterações. **Plan** investiga, questiona hipóteses, salva um plano e oferece a passagem para implementação. **Ask** responde sem editar arquivos. **Debug** investiga problemas. Agentes personalizados continuam configuráveis. Ferramentas e permissões dependem da configuração.

### O que ele faz

Há partes implementadas de conversas nativas, ferramentas e permissões, modelos e contas do Gateway, configurações, memória, indexação, sandbox e terminais. A paridade completa do VS Code, JetBrains, autocompletar/FIM, voz e alguns fluxos de nuvem continuam pendentes. Compartilhamento, validação de serviços implantados, assinatura e distribuição multiplataforma ainda têm requisitos abertos. Código presente não comprova aceitação de ponta a ponta.

### Documentação

Consulte o plano de migração e os planos de testes para saber o estado desta branch. A documentação geral do Kilo descreve o produto publicado e pode diferir desta prévia.

- [Kilo v2](migration-tracking/plans/kilo-opencode-v2-plan-progress.md)
- [Runtime](migration-tracking/test-plans/kilo-opencode-v2-test-plan-runtime.md) / [UI](migration-tracking/test-plans/kilo-opencode-v2-test-plan-ui.md)
- [Kilo](https://kilo.ai/docs)

### Contribuindo

Contribuições são bem-vindas. Leia o guia de contribuição e as convenções do fork v2 antes de alterar código compartilhado. Mantenha o comportamento do Kilo em pacotes próprios quando possível, verifique os pacotes afetados e preserve a atribuição ao projeto original.

- [Contribuindo](CONTRIBUTING.md)
- [Kilo v2](migration-tracking/technical-notes/v2-fork-conventions.md)

### Licença

[MIT](LICENSE)

### FAQ

<details>
<summary>De onde veio o Kilo CLI?</summary>

Kilo CLI é um fork do [OpenCode](https://github.com/anomalyco/opencode), aprimorado para funcionar dentro da plataforma de engenharia agêntica da Kilo.

</details>
