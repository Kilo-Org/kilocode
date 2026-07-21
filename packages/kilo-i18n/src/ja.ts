export const dict = {
  // Kilo Gateway provider translations
  "provider.connect.kiloGateway.line1":
    "Kilo Gatewayは、コーディングエージェント向けに厳選された信頼性の高い最適化モデルへのアクセスを提供します。",
  "provider.connect.kiloGateway.line2": "1つのAPIキーで、Claude、GPT、Gemini、GLMなどのモデルにアクセスできます。",
  "provider.connect.kiloGateway.visit.prefix": "",
  "provider.connect.kiloGateway.visit.link": "kilo.ai",
  "provider.connect.kiloGateway.visit.suffix": " にアクセスしてAPIキーを取得してください。",
  "provider.connect.kiloGateway.byok.prefix": "詳細な使用統計については、",
  "provider.connect.kiloGateway.byok.link": "Kilo's Gateway経由でBYOK",
  "provider.connect.kiloGateway.byok.suffix": "をご利用ください。",

  // Provider settings translations
  "settings.providers.group.recommended": "おすすめ",
  "settings.providers.note.kilo": "500以上のAIモデルにアクセス",
  "settings.providers.note.opencode": "Claude、GPT、Geminiなどの厳選モデル",
  "settings.providers.note.anthropic": "ProやMaxを含むClaudeモデルへ直接アクセス",
  "settings.providers.note.deepseek": "推論とコーディング作業向けのDeepSeekモデル",
  "settings.providers.note.copilot": "コーディング支援向けのClaudeモデル",
  "settings.providers.note.openai": "APIキーまたはChatGPTログインで使えるGPTとCodexモデル",
  "settings.providers.note.google": "高速で構造化された応答向けのGeminiモデル",
  "settings.providers.note.openrouter": "1つのプロバイダーからすべての対応モデルにアクセス",
  "settings.providers.note.vercel": "スマートルーティングによるAIモデルへの統合アクセス",

  // Reasoning block label
  "ui.permission.run": "実行",
  "ui.reasoning.label": "推論",

  // Marketplace
  "marketplace.tab.skills": "スキル",
  "marketplace.tab.mcpServers": "MCPサーバー",
  "marketplace.category.all": "すべて",
  "marketplace.placeholder": "未実装",
  "marketplace.card.installed": "インストール済み",
  "marketplace.card.install": "インストール",
  "marketplace.card.remove": "削除",
  "marketplace.card.removeScope": "削除 ({{scope}})",
  "marketplace.card.showMore": "もっと見る",
  "marketplace.card.showLess": "折りたたむ",
  "marketplace.install.title": "{{name}} のインストール",
  "marketplace.install.scope": "スコープ",
  "marketplace.install.scope.project": "プロジェクト",
  "marketplace.install.scope.global": "グローバル",
  "marketplace.install.scope.project.description":
    "このプロジェクトのみ。インストールしたファイルはバージョン管理に追加し、チームと共有できます。",
  "marketplace.install.scope.global.description":
    "このマシン上のすべてのプロジェクト。ユーザー設定に保存されます。",
  "marketplace.install.destination": "インストール先",
  "marketplace.install.about.mcp":
    "MCPサーバーは、外部サービスやローカルプログラムを操作するための追加ツールをKiloに提供します。",
  "marketplace.install.about.agent": "エージェントは、独自の指示と権限を持つ再利用可能な役割を追加します。",
  "marketplace.install.about.skill":
    "スキルは、必要に応じてKiloが読み込めるタスク固有の指示とリソースを追加します。",
  "marketplace.install.mcp.warning":
    "MCPサーバーはローカルコマンドを実行したり、外部サービスに接続したりできます。権限で自動的に許可されていない限り、Kiloはツールを使用する前に許可を求めます。",
  "marketplace.install.project.warning":
    "プロジェクトファイルはバージョン管理に追加される場合があります。設定で環境変数を参照している場合を除き、ここにシークレットを保存しないでください。",
  "marketplace.install.learnMore": "Marketplaceからのインストールの仕組みを見る",
  "marketplace.install.learnMcp": "MCPについて詳しく見る",
  "marketplace.install.installedAt": "{{path}} にインストール済み",
  "marketplace.intro":
    "再利用可能なエージェント、スキル、MCPツールを1つのプロジェクトまたはすべてのプロジェクトにインストールできます。",
  "marketplace.intro.learnMore": "Marketplaceについて",
  "marketplace.install.prerequisites": "前提条件",
  "marketplace.install.installing": "インストール中...",
  "marketplace.install.cancel": "キャンセル",
  "marketplace.install.success": "インストールが完了しました！",
  "marketplace.install.failed": "インストールに失敗しました",
  "marketplace.install.done": "完了",
  "marketplace.install.close": "閉じる",
  "marketplace.remove.title": "{{name}} を削除しますか？",
  "marketplace.remove.confirm": "この{{type}}を削除してもよろしいですか？ これにより、{{scope}}設定から削除されます。",
  "marketplace.remove.cancel": "キャンセル",
  "marketplace.remove.confirm.button": "削除",
  "marketplace.tab.mcp": "MCP",
  "marketplace.tab.agents": "エージェント",
  "marketplace.search": "検索...",
  "marketplace.filter.all": "すべてのアイテム",
  "marketplace.filter.notInstalled": "未インストール",
  "marketplace.filter.relevant": "自分のワークスペースに関連",
  "marketplace.empty": "アイテムが見つかりません",
  "marketplace.empty.relevant": "このワークスペースに関連するマーケットプレイスのアイテムが見つかりませんでした。",
  "marketplace.badge.mcpServer": "MCPサーバー",
  "marketplace.badge.mode": "モード",
  "marketplace.card.by": "作成者: {{author}}",
  "marketplace.install.method": "インストール方法",
  "marketplace.install.parameters": "パラメーター",
  "marketplace.install.optional": "(任意)",
  "marketplace.install.required": "{{name}} は必須です",
  "marketplace.scope.project": "プロジェクト",
  "marketplace.scope.global": "グローバル",
  "marketplace.remove.type.mcp": "MCPサーバー",
  "marketplace.remove.type.skill": "スキル",
  "marketplace.remove.type.agent": "エージェント",
  "marketplace.remove.failed": "{{name}} の削除に失敗しました",
  "marketplace.install": "インストール",
  "marketplace.filter.installed": "インストール済み",
  "marketplace.error.dismiss": "閉じる",
  "marketplace.warning.busyOne": "1つのセッションが実行中で中断されます",
  "marketplace.warning.busyMany": "複数のセッションが実行中で中断されます",
  "marketplace.warning.installAnyway": "それでもインストール",
  "marketplace.warning.cancel": "キャンセル",
  "marketplace.contribute.prompt": "スキル、エージェント、またはMCPサーバーが見つかりませんか？",
  "marketplace.contribute.cta": "GitHub で貢献する",
  "marketplace.migration.notice":
    "モードはエージェントに置き換えられました。以前にマーケットプレイスのモードをインストールしていた場合は、新しい形式に移行するためにそれらを削除してエージェントとして再インストールしてください。",

  // Plan follow-up question shown after plan_exit
  "plan.followup.header": "実装",
  "plan.followup.question": "実装する準備はできましたか？",
  "plan.followup.answer.newSession": "新しいセッションを開始",
  "plan.followup.answer.newSession.description": "クリーンなコンテキストの新しいセッションで実装する",
  "plan.followup.answer.continue": "ここで続行",
  "plan.followup.answer.continue.description": "このセッションで計画を実装する",
  "plan.followup.answer.keepRefining": "さらに調整する",
  "plan.followup.answer.keepRefining.description": "まだ実装せずに計画を続ける",

  // Slow-repo snapshot prompt
  "snapshot.slowRepo.header": "スナップショットが遅い",
  "snapshot.slowRepo.question":
    "リポジトリのサイズのためか、スナップショットシステムの初期化に時間がかかっています。\n\nこのリポジトリのスナップショットを無効にしますか？",
  "snapshot.slowRepo.answer.continue": "スナップショットを続行",
  "snapshot.slowRepo.answer.continue.description":
    "スナップショットが完了するまで待機します。初回のスナップショットが作成された後は、以降のターンは高速になります。",
  "snapshot.slowRepo.answer.disable": "このプロジェクトで無効化",
  "snapshot.slowRepo.answer.disable.description":
    "このプロジェクトでは Kilo のスナップショットを無効にします。Kilo による変更の取り消し/やり直しはできなくなりますが、git は引き続きすべてを追跡します。",

  // Edit-tool header and shell-tool section labels
  "ui.messagePart.openInDiffViewer": "差分ビューアーで開く",
  "ui.messagePart.shell.command": "コマンド",
  "ui.messagePart.shell.output": "出力",
  "ui.messagePart.openInEditor": "エディタで開く",

  // Message feedback (thumbs up/down per assistant response)
  "ui.message.feedback.helpful": "役に立ちました",
  "ui.message.feedback.notHelpful": "役に立ちませんでした",
  "ui.message.feedback.clearRating": "評価をクリア",
}
