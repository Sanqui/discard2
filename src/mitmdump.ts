import { spawn } from 'child_process';

export class Mitmdump {
    process: any;
    filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    async start() {
        console.log("Starting mitmdump");
        this.process = spawn('bin/mitmdump', ["-q", "-w", this.filePath])

        this.process.stderr.on('data', data => {
            console.log("mitmdump stderr: ", data.toString());
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
    }

    async close() {
        console.log("Stopping mitmdump");
        this.process.kill();
    }
}