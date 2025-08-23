import * as vscode from "vscode";
import { TextEncoder, TextDecoder } from "util";
import { WriterAgent } from './writer-agent';
import { EditorAgent } from './editor-agent';
import { NovelConfig, Chapter } from './types';
import { ClineProvider } from "../core/webview/ClineProvider";
import { getReviewPanelHtml } from './review-panel';

export class Orchestrator {
    private rootUri!: vscode.Uri;
    private writerAgent!: WriterAgent;
    private editorAgent!: EditorAgent;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly outputChannel: vscode.OutputChannel,
        private readonly provider: ClineProvider,
    ) {}

    async start() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let projectRoot: vscode.Uri | undefined;

        if (workspaceFolders && workspaceFolders.length > 0) {
            // Check if any of the workspace folders is a novel project
            for (const folder of workspaceFolders) {
                const configUri = vscode.Uri.joinPath(folder.uri, 'config.json');
                if (await this.fileExists(configUri)) {
                    projectRoot = folder.uri;
                    break;
                }
            }
        }

        if (projectRoot) {
            this.rootUri = projectRoot;
            const action = await vscode.window.showQuickPick(
                ['Iniciar Geração do Livro', 'Inicializar Novo Projeto (em outra pasta)'],
                { placeHolder: `Projeto de romance encontrado em ${projectRoot.fsPath}. O que fazer?` }
            );
            if (!action) return;
            if (action === 'Iniciar Geração do Livro') {
                await this.runGenerationLoop();
            } else {
                await this.initializeProject();
            }
        } else {
            await this.initializeProject();
        }
    }

    private async runGenerationLoop() {
        this.outputChannel.appendLine("Iniciando o loop de geração...");

        const config = await this.readConfig();
        if (!config) {
            vscode.window.showErrorMessage("Não foi possível ler o arquivo config.json. Verifique se o arquivo existe e está no formato correto na raiz do projeto.");
            return;
        }

        this.writerAgent = new WriterAgent(config.writerModel, this.provider);
        this.editorAgent = new EditorAgent(config.editorModel, this.provider);

        const chapters = await this.parseOutline();
        if (chapters.length === 0) {
            vscode.window.showErrorMessage("Nenhum capítulo encontrado em esboco.md. Certifique-se de que os capítulos estão formatados com '## Título do Capítulo'.");
            return;
        }

        for (let i = 0; i < chapters.length; i++) {
            const chapter = chapters[i];
            const chapterFileName = `capitulo_${String(i + 1).padStart(2, '0')}.md`;
            const chapterUri = vscode.Uri.joinPath(this.rootUri, 'manuscrito', chapterFileName);

            if (await this.fileExists(chapterUri)) {
                this.outputChannel.appendLine(`Capítulo '${chapter.title}' já existe. Pulando.`);
                continue;
            }

            this.outputChannel.appendLine(`Iniciando ciclo de escrita para o capítulo: ${chapter.title}`);

            let approved = false;
            let feedback: string | undefined = undefined;
            let attempt = 1;

            while (!approved) {
                this.outputChannel.appendLine(`Tentativa de escrita #${attempt} para o capítulo '${chapter.title}'.`);

                const writerContext = await this.prepareWriterContext(chapter, i, feedback);
                const draftContent = await this.writerAgent.writeChapter(writerContext);
                await this.writeFile(chapterUri, draftContent);
                this.outputChannel.appendLine(`Rascunho de '${chapter.title}' (tentativa #${attempt}) salvo.`);

                const editorContext = await this.prepareEditorContext();
                const editorReport = await this.editorAgent.reviewManuscript(editorContext);
                this.outputChannel.appendLine(`Revisão do Editor (tentativa #${attempt}) concluída.`);

                const userDecision = await this.presentForHumanReview(editorReport);

                if (userDecision.action === 'Aprovar') {
                    approved = true;
                    this.outputChannel.appendLine(`Capítulo '${chapter.title}' aprovado!`);
                } else {
                    feedback = userDecision.feedback;
                    attempt++;
                    this.outputChannel.appendLine(`Revisão solicitada. Feedback: ${feedback}`);
                    vscode.window.showInformationMessage(`Preparando para reescrever o capítulo com base no seu feedback.`);
                }
            }
        }

        this.outputChannel.appendLine("Todos os capítulos do esboço foram gerados!");
        vscode.window.showInformationMessage("Geração do livro concluída!");
    }

    private async initializeProject() {
        const uris = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: "Selecione a Pasta para o Novo Romance"
        });

        if (!uris || uris.length === 0) {
            vscode.window.showInformationMessage("Nenhuma pasta selecionada. A inicialização do projeto foi abortada.");
            return;
        }

        const rootUri = uris[0];
        this.outputChannel.appendLine(`Inicializando novo projeto de romance em: ${rootUri.fsPath}`);

        try {
            const manuscritoUri = vscode.Uri.joinPath(rootUri, 'manuscrito');
            const bibliaUri = vscode.Uri.joinPath(rootUri, 'biblia_da_historia');
            await vscode.workspace.fs.createDirectory(manuscritoUri);
            await vscode.workspace.fs.createDirectory(bibliaUri);

            const configUri = vscode.Uri.joinPath(rootUri, 'config.json');
            const configContent = {
                writerModel: "claude-3-opus-20240229",
                editorModel: "gemini/gemini-1.5-pro-latest"
            };
            await this.writeFile(configUri, JSON.stringify(configContent, null, 2));

            const esbocoUri = vscode.Uri.joinPath(rootUri, 'esboco.md');
            const esbocoContent = `## Capítulo 1: O Encontro Inesperado\n\n- Personagem Principal (PP) encontra um artefato antigo em uma loja de antiguidades.\n\n## Capítulo 2: O Chamado à Aventura\n\n- O artefato revela um mapa ou uma profecia, forçando o PP a deixar sua vida para trás.`;
            await this.writeFile(esbocoUri, esbocoContent);

            const personagensUri = vscode.Uri.joinPath(bibliaUri, 'personagens.md');
            const personagensContent = `# Guia de Personagens\n\n## [Nome do Personagem]\n- **Arquétipo:** (Ex: O Mentor, O Guardião, O Malandro)\n- **Motivação:** (O que o personagem mais deseja?)\n- **Conflito Interno:** (Qual dilema moral ou falha ele enfrenta?)\n- **Descrição Física:**\n- **Traços de Personalidade:**`;
            await this.writeFile(personagensUri, personagensContent);

            const mundoUri = vscode.Uri.joinPath(bibliaUri, 'mundo.md');
            const mundoContent = `# Guia do Mundo\n\n## [Nome da Região/Conceito]\n- **Sistema de Magia/Tecnologia:** (Como funciona? Quais são suas regras e limitações?)\n- **Cultura e Sociedade:** (Quais são os costumes, leis, e estrutura social?)\n- **Geografia:** (Descreva as paisagens, cidades importantes, e locais perigosos.)`;
            await this.writeFile(mundoUri, mundoContent);

            const tomEstiloUri = vscode.Uri.joinPath(bibliaUri, 'tom_e_estilo.md');
            const tomEstiloContent = `# Tom e Estilo da Narrativa\n\n- **Gênero Principal:** (Ex: Fantasia Sombria, Ficção Científica Hard, Suspense Psicológico)\n- **Tom:** (Ex: Otimista e aventuresco, sombrio e cínico, bem-humorado e satírico)\n- **Estilo de Prosa:** (Ex: Direto e funcional, lírico e descritivo, rápido e cheio de ação)\n- **Temas Centrais:** (Quais grandes questões a história explora? Ex: sacrifício, redenção, o custo do poder).`;
            await this.writeFile(tomEstiloUri, tomEstiloContent);

            vscode.window.showInformationMessage(`Projeto de romance criado com sucesso em ${rootUri.fsPath}. Adicione a pasta ao seu workspace para começar a gerar.`);

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Falha ao criar a estrutura do projeto: ${message}`);
            this.outputChannel.appendLine(`Erro ao inicializar o projeto: ${message}`);
        }
    }

    private async readConfig(): Promise<NovelConfig | null> {
        try {
            const configUri = vscode.Uri.joinPath(this.rootUri, 'config.json');
            const rawContent = await vscode.workspace.fs.readFile(configUri);
            const content = new TextDecoder().decode(rawContent);
            return JSON.parse(content) as NovelConfig;
        } catch (error) {
            this.outputChannel.appendLine(`Erro ao ler config.json: ${error}`);
            return null;
        }
    }

    private async parseOutline(): Promise<Chapter[]> {
        try {
            const esbocoUri = vscode.Uri.joinPath(this.rootUri, 'esboco.md');
            const rawContent = await vscode.workspace.fs.readFile(esbocoUri);
            const content = new TextDecoder().decode(rawContent);

            const chapters: Chapter[] = [];
            const chapterRegex = /^##\s+(.*)$/gm;
            const sections = content.split(chapterRegex);

            if (sections.length < 3) return [];

            for (let i = 1; i < sections.length; i += 2) {
                const title = sections[i].trim();
                const summary = sections[i+1].trim();
                chapters.push({ title, summary });
            }
            return chapters;
        } catch (error) {
            this.outputChannel.appendLine(`Erro ao ler esboco.md: ${error}`);
            return [];
        }
    }

    private async prepareWriterContext(currentChapter: Chapter, chapterIndex: number, feedback?: string): Promise<any> {
        this.outputChannel.appendLine(`Preparando contexto para o escritor para o capítulo: ${currentChapter.title}`);
        let previousChapterContent = '';
        if (chapterIndex > 0) {
            const prevChapterFileName = `capitulo_${String(chapterIndex).padStart(2, '0')}.md`;
            const prevChapterUri = vscode.Uri.joinPath(this.rootUri, 'manuscrito', prevChapterFileName);
            if (await this.fileExists(prevChapterUri)) {
                const rawContent = await vscode.workspace.fs.readFile(prevChapterUri);
                previousChapterContent = new TextDecoder().decode(rawContent);
            }
        }

        const bibliaUri = vscode.Uri.joinPath(this.rootUri, 'biblia_da_historia');
        const personagensUri = vscode.Uri.joinPath(bibliaUri, 'personagens.md');
        let personagensContent = "Nenhum perfil de personagem encontrado.";
        if (await this.fileExists(personagensUri)) {
            const rawContent = await vscode.workspace.fs.readFile(personagensUri);
            personagensContent = new TextDecoder().decode(rawContent);
        }

        return {
            summary: currentChapter.summary,
            previousChapter: previousChapterContent,
            characters: personagensContent,
            feedback: feedback
        };
    }

    private async prepareEditorContext(): Promise<string> {
        this.outputChannel.appendLine(`Preparando contexto para o editor.`);
        const manuscritoUri = vscode.Uri.joinPath(this.rootUri, 'manuscrito');
        const bibliaUri = vscode.Uri.joinPath(this.rootUri, 'biblia_da_historia');

        let fullText = '--- INÍCIO DO MANUSCRITO ---\n';

        const manuscritoFiles = await vscode.workspace.fs.readDirectory(manuscritoUri);
        manuscritoFiles.sort((a, b) => a[0].localeCompare(b[0]));
        for (const [fileName, fileType] of manuscritoFiles) {
            if (fileType === vscode.FileType.File) {
                const chapterUri = vscode.Uri.joinPath(manuscritoUri, fileName);
                const rawContent = await vscode.workspace.fs.readFile(chapterUri);
                fullText += new TextDecoder().decode(rawContent) + '\n\n';
            }
        }
        fullText += '--- FIM DO MANUSCRITO ---\n\n--- INÍCIO DA BÍBLIA DA HISTÓRIA ---\n';

        const bibliaFiles = await vscode.workspace.fs.readDirectory(bibliaUri);
        for (const [fileName, fileType] of bibliaFiles) {
             if (fileType === vscode.FileType.File) {
                const bibliaFileUri = vscode.Uri.joinPath(bibliaUri, fileName);
                const rawContent = await vscode.workspace.fs.readFile(bibliaFileUri);
                fullText += `## ${fileName}\n\n` + new TextDecoder().decode(rawContent) + '\n\n';
            }
        }
        fullText += '--- FIM DA BÍBLIA DA HISTÓRIA ---';

        return fullText;
    }

    private async presentForHumanReview(report: string): Promise<{ action: 'Aprovar' | 'Revisar', feedback?: string }> {
        this.outputChannel.appendLine("Apresentando para revisão humana...");

        const panel = vscode.window.createWebviewPanel(
            'autorOrquestradorReview',
            'Revisão do Editor',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'src', 'autor-orquestrador')]
            }
        );

        const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'src', 'autor-orquestrador', 'review-panel-script.js'));
        // Using a generic style from the extension for consistency. A dedicated one could be created.
        const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'webview-ui', 'src', 'index.css'));

        panel.webview.html = getReviewPanelHtml(report, panel.webview.cspSource, scriptUri, styleUri);

        return new Promise(resolve => {
            panel.webview.onDidReceiveMessage(
                message => {
                    switch (message.command) {
                        case 'approve':
                            resolve({ action: 'Aprovar' });
                            panel.dispose();
                            return;
                        case 'revise':
                            resolve({ action: 'Revisar', feedback: message.feedback });
                            panel.dispose();
                            return;
                    }
                },
                undefined,
                this.context.subscriptions
            );

            panel.onDidDispose(
                () => {
                    // If the user closes the panel without making a choice, we'll treat it as a request to revise.
                    resolve({ action: 'Revisar', feedback: 'Painel de revisão fechado pelo usuário.' });
                },
                null,
                this.context.subscriptions
            );
        });
    }

    private async writeFile(uri: vscode.Uri, content: string) {
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    }

    private async fileExists(uri: vscode.Uri): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(uri);
            return true;
        } catch {
            return false;
        }
    }
}
