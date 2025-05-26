class App {
    run(): void {
        const processor = new DataProcessor();
        console.log(processor.process("test"));
    }
}

class DataProcessor {
    process(data: string): string {
        return data.toUpperCase();
    }
}

const app = new App();
app.run();