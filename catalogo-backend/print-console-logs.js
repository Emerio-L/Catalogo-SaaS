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
            if (data.step_index > 950 && data.tool_calls) {
                console.log(`Step ${data.step_index} calls tools:`, JSON.stringify(data.tool_calls));
            }
            if (data.step_index > 950 && data.type === 'tool_response') {
                console.log(`Step ${data.step_index} tool response:`, data.content?.slice(0, 1000));
            }
            // If it's a model response or system output containing log objects
            if (data.step_index > 950 && (line.includes('console') || line.includes('log') || line.includes('error'))) {
                // If it looks like a browser subagent's step or tool output
                if (data.tool_calls || data.type === 'tool_response' || data.content?.includes('console')) {
                    console.log(`Step ${data.step_index} matches pattern:`, data.content?.slice(0, 500) || JSON.stringify(data.tool_calls));
                }
            }
        } catch (e) {}
    }
}

run();
