import { spawn } from 'child_process';

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
        this.process = spawn('bin/mitmdump', args)
        this.closed = false;

        process.on('beforeExit', async () => {
            if (!this.closed) {
                await this.close();
            }
        });

        this.process.stderr.on('data', data => {
            console.log("mitmdump stderr: ", data.toString());
            throw new Error(`mitmdump failed`);
        });

        this.process.on('exit', code => {
            if (code != 0) {
                throw new Error(`mitmdump exited with code ${code}`);
            }
        });

        /*let stdout = '';
        for await (const chunk of this.process.stdout) {
            stdout += chunk.toString();
            if (stdout.includes('Proxy server listening at http://*:8080')) {
                console.log("mitmdump started");
                return;
            }
        }*/
        // Quiet mitmdump produces no output, so just wait a second
        // for it to pick itself up...
        await new Promise(r => setTimeout(r, 1000));
    }

    async close() {
        console.log("Stopping mitmdump");
        await this.process.kill();
        this.closed = true;
    }
}