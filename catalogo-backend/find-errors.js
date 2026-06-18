const fs = require('fs');
const readline = require('readline');

async function run() {
    const logPath = 'C:\\Users\\estlu\\.gemini\\antigravity-ide\\brain\\43ac5f15-79d8-4937-a20e-8cc1956fa073\\.system_generated\\logs\\transcript.jsonl';
    const fileStream = fs.createReadStream(logPath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const data = JSON.parse(line);
            // Search in step content or tool outputs
            const isConsoleLogResult = data.tool_calls && data.tool_calls.some(tc => tc.name === 'capture_browser_console_logs');
            const content = data.content || '';
            
            // If it's a step where capture_browser_console_logs output was returned:
            if (content.includes('ConsoleLog') || content.includes('console.log') || isConsoleLogResult || (data.step_index > 900 && content.includes('log') && content.includes('level'))) {
                console.log(`Step ${data.step_index}:`);
                console.log(content.slice(0, 1000));
                console.log('===================================');
            }
        } catch (e) {}
    }
}

run();
