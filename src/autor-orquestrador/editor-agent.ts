import { ClineProvider } from "../core/webview/ClineProvider";
import { LanguageModelMessage } from "@roo-code/types";

// This file will contain the logic for the editor agent.
export class EditorAgent {
    constructor(private model: string, private provider: ClineProvider) {}

    async reviewManuscript(context: string): Promise<string> {
        console.log(`Reviewing manuscript with model: ${this.model}`);

        const systemPrompt = "Você é um editor de livros meticuloso e implacável, com um olho de águia para a continuidade. Sua tarefa é analisar o manuscrito completo fornecido e compará-lo com a 'Bíblia da História'. Seu objetivo é encontrar QUALQUER inconsistência, não importa quão pequena. Verifique:\n1. **Furos no Enredo:** Eventos que contradizem fatos estabelecidos anteriormente.\n2. **Inconsistências de Personagem:** Personagens agindo de forma contrária às suas motivações, personalidade ou capacidades definidas na 'Bíblia da História'.\n3. **Contradições do Mundo:** Violações das regras do mundo (física, magia, política) estabelecidas.\n4. **Erros de Continuidade Temporal:** Eventos que acontecem fora de uma sequência lógica.\nSua saída deve ser uma lista clara e concisa, em formato de marcadores, detalhando cada problema encontrado e, se possível, sugerindo uma ou duas maneiras de corrigi-lo. Se nenhum problema for encontrado, responda com \"Nenhuma inconsistência encontrada.\"";

        const messages: LanguageModelMessage[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context }
        ];

        try {
            const response = await this.provider.provider.getCompletion(messages, { model: this.model });
            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`Error calling editor agent: ${message}`);
            return `Erro ao revisar o manuscrito: ${message}`;
        }
    }
}
