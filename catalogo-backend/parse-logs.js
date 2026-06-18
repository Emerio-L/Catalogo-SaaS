const fs = require('fs');
const readline = require('readline');

async function run() {
    const fileStream = fs.createReadStream('C:\\Users\\estlu\\.gemini\\antigravity-ide\\brain\\3a97f015-07a0-47e9-b358-57628559309d\\.system_generated\\logs\\transcript.jsonl');
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    for await (const line of rl) {
        try {
            const step = JSON.parse(line);
            if (step.source === 'USER_EXPLICIT' || step.type === 'USER_INPUT') {
                console.log(`[STEP ${step.step_index}] SOURCE: ${step.source}, TYPE: ${step.type}`);
                console.log(`Content: ${step.content ? step.content.substring(0, 500) : 'N/A'}`);
                console.log('--------------------------------------------------');
            }
        } catch (e) {
            // ignore
        }
    }
}

run();
