import { spawn } from 'child_process';

import { CaptureTool } from './captureTools';

export class Tshark extends CaptureTool {
    process: any;
    filePath: string;
    closed: boolean;
    stderr: string;

    constructor(dataPath: string) {
        super(dataPath);
        
        this.filePath = dataPath + '/capture.pcapng';
    }

    async start() {
        process.on('beforeExit', async () => {
                await this.close();
            }
        );

        process.on('uncaughtExceptionMonitor', async () => {
                await this.close();
            }
        );

        console.log("Starting tshark");
        this.closed = false;
        this.stderr = "";
        let args = [
            '-w', this.filePath,
            // Capture all interfaces
            '-ni', 'any',
            // Ignore loopback traffic -- Chrome (perhaps with Puppeteer) is extremely noisy
            '-f', 'not (src 127.0.0.1 and dst 127.0.0.1 and not port 8080)',
        ];
        this.process = spawn('tshark', args).on('exit', code => {
            if (code != 0 && code != 255) {
                console.log("tshark stderr: " + this.stderr);
                throw new Error(`tshark exited with code ${code}`);
            }
        });

        for await (const chunk of this.process.stderr) {
            //console.log("tshark stderr: " + chunk);
            this.stderr += chunk.toString();
            //if (this.stderr.includes("Capture started.")) {
            if (this.stderr.includes("Capturing on '")) {
                console.log("tshark started");
                this.stderr = "";

                this.process.stderr.on('data', data => {
                    this.stderr += data.toString();
                    //console.log("tshark stderr: ", data.toString());
                });
                return;
            }
        }
        await new Promise(r => setTimeout(r, 100));
    }

    async close() {
        if (!this.closed) {
            console.log("Stopping tshark");
            await this.process.kill();
            this.closed = true;
        }
    }
}