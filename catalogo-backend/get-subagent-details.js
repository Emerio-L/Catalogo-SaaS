const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\estlu\\.gemini\\antigravity-ide\\brain';

function findTranscripts(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            if (file === '.system_generated') {
                const logsDir = path.join(filePath, 'logs');
                if (fs.existsSync(logsDir)) {
                    const transFile = path.join(logsDir, 'transcript.jsonl');
                    if (fs.existsSync(transFile)) {
                        results.push(transFile);
                    }
                }
            } else {
                results = results.concat(findTranscripts(filePath));
            }
        }
    });
    return results;
}

async function run() {
    try {
        const files = findTranscripts(brainDir);
        for (const file of files) {
            const content = fs.readFileSync(file, 'utf8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.trim()) continue;
                if (line.includes('TypeError') || line.includes('ReferenceError') || line.includes('Cannot read properties') || line.includes('Failed to execute')) {
                    try {
                        const data = JSON.parse(line);
                        // Only print if it's from recent steps or contains browser console/error info
                        console.log(`File: ${file}, Step: ${data.step_index}`);
                        console.log(line.slice(0, 1000));
                        console.log('===================================');
                    } catch (e) {
                        // In case JSON parse fails, print raw line snippet
                        console.log(`Raw match in ${file} line ${i}:`);
                        console.log(line.slice(0, 500));
                    }
                }
            }
        }
    } catch (err) {
        console.error(err);
    }
}

run();
