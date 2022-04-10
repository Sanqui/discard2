import { spawn, ChildProcess } from 'child_process';

import { CaptureTool } from './captureTools';

export class Tshark extends CaptureTool {
    process: ChildProcess;
    filePath: string;
    closed: boolean;
    stderr: string;

    constructor(dataPath: string) {
        super(dataPath);
        
        this.filePath = dataPath + '/capture.pcapng';
    }

    async start() {
        process.on('beforeExit', () => {
                this.close();
            }
        );

        process.on('uncaughtExceptionMonitor', () => {
                this.close();
            }
        );

        console.log("Starting tshark");
        this.closed = false;
        this.stderr = "";
        const args = [
            '-w', this.filePath,
            // Capture all interfaces
            '-ni', 'any',
            // Ignore loopback traffic -- Chrome (perhaps with Puppeteer) is extremely noisy
            '-f', 'not (src 127.0.0.1 and dst 127.0.0.1 and not port 8080)',
            // Increase buffer size from 2MB to 32MB to be safe
            // this may fix dropped packets on loopback in podman
            // see https://osqa-ask.wireshark.org/questions/25391/are-there-conditions-that-can-cause-wireshark-to-drop-packets/
            '--buffer-size', '32'
        ];

        this.process = spawn('tshark', args)

        for await (const chunk of this.process.stderr) {
            //console.log("tshark stderr: " + chunk);
            this.stderr += chunk.toString();
            //if (this.stderr.includes("Capture started.")) {
            if (this.stderr.includes("Capturing on '")) {
                //console.log("tshark stderr: ", this.stderr);
                console.log("tshark started");
                break;
            }
        }
        
        await new Promise(r => setTimeout(r, 100));

        if (this.process.exitCode) {
            throw new Error(`tshark exited early with code ${this.process.exitCode}\nstderr: ${this.stderr}\nstderr read: ${this.process.stderr.read().toString()}`);
        } else {
            this.stderr += this.process.stderr.read();
            //this.process.stderr.on('data', data => {
            //    //this.stderr += data.toString();
            //    //console.log("tshark stderr: ", data.toString());
            //});
            this.process.on('exit', code => {
                if (code != 0 && code != 255) {
                    //console.log("tshark stderr: " + this.stderr);
                    throw new Error(`tshark exited with code ${code}\nstderr: ${this.stderr}\nstderr read: ${this.process.stderr.read().toString()}`);
                }
            });
        }
    }

    close() {
        if (!this.closed) {
            console.log("Stopping tshark");
            this.process.kill();
            this.closed = true;
        }
    }
}