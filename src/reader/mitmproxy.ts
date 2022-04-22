import { spawn } from 'child_process';

import JsonlParser from 'stream-json/jsonl/Parser';

import { ReaderOutput } from './output';

export async function readMitmproxy(
    path: string,
    log: (...args: unknown[]) => void,
    logDebug: (...args: unknown[]) => void,
    output: (data: ReaderOutput) => void
) {
    const process = spawn('python', [
        'mitmproxy/read.py',
        path + '/capture.mitmdump'
    ]);

    process.on('exit', code => {
        if (code != 0 && code != 255) {
            console.error("mitmproxy read stderr: " + process.stderr.read().toString());
            throw new Error(`mitmproxy read exited with code ${code}`);
        }
    });

    for await (const obj of process.stdout.pipe(new JsonlParser())) {
        output(obj.value as ReaderOutput);
    }
}