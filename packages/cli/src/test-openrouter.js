// Simple script to test OpenRouter API directly
const { OpenAI } = require('openai');

async function testOpenRouter() {
    // Get API key from environment variable
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        console.error('Error: OPENROUTER_API_KEY environment variable not set');
        process.exit(1);
    }

    console.log(`Using API key: ${apiKey.slice(0, 10)}...`);

    // Create OpenRouter client
    const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: apiKey,
        defaultHeaders: {
            'HTTP-Referer': 'https://kilocode.com',
            'X-Title': 'Kilo CLI Test',
            'Authorization': `Bearer ${apiKey}`
        }
    });

    try {
        // Make a simple request to test authentication
        const response = await client.chat.completions.create({
            model: 'anthropic/claude-3.5-sonnet',
            messages: [{ role: 'user', content: 'Say hello' }],
            max_tokens: 10
        });

        console.log('API request successful!');
        console.log('Response:', response);
    } catch (error) {
        console.error('API request failed:');
        console.error('Status:', error.status);
        console.error('Message:', error.message);
        console.error('Error details:', error.error);

        if (error.response) {
            console.error('Response headers:', error.response.headers);
            console.error('Response data:', error.response.data);
        }
    }
}

testOpenRouter();