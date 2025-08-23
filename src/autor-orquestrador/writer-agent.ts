import { ClineProvider } from "../core/webview/ClineProvider";
import { LanguageModelMessage } from "@roo-code/types";

// This file will contain the logic for the writer agent.
export class WriterAgent {
    constructor(private model: string, private provider: ClineProvider) {}

    async writeChapter(context: any): Promise<string> {
        console.log(`Writing chapter with model: ${this.model}`);

        const systemPrompt = "Você é um mestre da ficção, um romancista premiado. Sua tarefa é escrever um único capítulo de um livro com base no contexto fornecido. Sua prosa deve ser envolvente, com diálogos realistas e descrições vívidas. Mantenha-se estritamente dentro dos limites do resumo do capítulo e do tom estabelecido. Não invente novos pontos de enredo. Foque na qualidade da escrita, no ritmo da cena e na profundidade emocional.";

        let userPrompt = `**Resumo do Capítulo Atual:**\n${context.summary}\n\n**Texto do Capítulo Anterior:**\n${context.previousChapter || 'Este é o primeiro capítulo.'}\n\n**Perfis de Personagens Relevantes:**\n${context.characters}`;

        if (context.feedback) {
            userPrompt += `\n\n**Feedback da Revisão Anterior (leia com atenção e aplique as mudanças solicitadas):**\n${context.feedback}`;
        }

        const messages: LanguageModelMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ];

        try {
            const response = await this.provider.provider.getCompletion(messages, { model: this.model });
            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error calling writer agent: ${message}`);
            return `Erro ao gerar capítulo: ${message}`;
        }
    }
}
