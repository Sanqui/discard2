import { spawn } from 'child_process';
import * as fs from 'fs';

var tcpPortUsed = require('tcp-port-used');

//const MITMDUMP_PATHS = ['mitmproxy/venv/bin/mitmdump', 'bin/mitmdump'];
const MITMDUMP_PATHS = ['bin/mitmdump'];
let mitmdumpPath: string = null;

for (const path of MITMDUMP_PATHS) {
    if (fs.existsSync(path)) {
        mitmdumpPath = path;
        break;
    }
}

if (!mitmdumpPath) {
    throw new Error('Could not find mitmdump');
}

console.log(`Using mitmdump at ${mitmdumpPath}`);

export class Mitmdump {
    process: any;
    filePath: string;
    replay: boolean;
    closed: boolean;

    constructor(filePath: string, replay?: boolean) {
        this.filePath = filePath;
        this.replay = replay || false;
        this.closed = true;
    }

    async start() {
        console.log("Starting mitmdump");
        let args = [];
        if (!this.replay) {
            args = ["-q", "-w", this.filePath]
        } else {
            args = ["-q", "--server-replay", this.filePath]
        }
        this.closed = false;

        process.on('beforeExit', async () => {
                await this.close();
            }
        );

        process.on('uncaughtExceptionMonitor', async () => {
                await this.close();
            }
        );

        this.process = spawn(mitmdumpPath, args).on('exit', code => {
            if (code != 0) {
                throw new Error(`mitmdump exited with code ${code}`);
            }
        });

        this.process.stderr.on('data', data => {
            console.log("mitmdump stderr: ", data.toString());
            //throw new Error(`mitmdump failed`);
        });

        /*let stdout = '';
        for await (const chunk of this.process.stdout) {
            stdout += chunk.toString();
            if (stdout.includes('Proxy server listening at http://*:8080')) {
                console.log("mitmdump started");
                return;
            }
        }*/
        // Quiet mitmdump produces no output, so wait
        // for it to pick itself up...
        await new tcpPortUsed.waitUntilUsed(8080, 500, 4000)
        await new Promise(r => setTimeout(r, 2000));
    }

    async close() {
        if (!this.closed) {
            console.log("Stopping mitmdump");
            await this.process.kill();
            this.closed = true;
        }
    }
}