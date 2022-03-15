import { spawn } from 'child_process';

export class Warcprox {
    process: any;

    async start() {
        console.log("Starting warcprox");
        this.process = spawn('../.venv/bin/warcprox', {
            'cwd': 'warcprox/'
        })
        
        this.process.stderr.on('data', data => {
            if (data.toString().includes('Address already in use')) {
                throw new Error("Warcprox failed to bind to port; there may be a leftover instance");
            }
        });
        
        this.process.on('exit', code => {
            if (code != 120) {
                throw new Error(`warcprox exited with code ${code}`);
            }
        });

        let stdout = '';
        for await (const chunk of this.process.stdout) {
            stdout += chunk.toString();
            if (stdout.includes('listening on 127.0.0.1:8000')) {
                console.log("warcprox started");
                return;
            }
        }
    }

    async close() {
        console.log("Stopping warcprox");
        this.process.kill();
    }
}