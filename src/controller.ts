import * as fs from 'fs/promises';
import { spawn } from 'child_process';

import { Mitmdump } from './mitmdump';

let crawler_process;

async function run_crawler(): Promise<boolean> {
    // returns true if it should be restarted, false if it is done
    return new Promise((resolve, reject) => {
        let restart = false;
        console.log("Starting crawler_process");
        crawler_process = spawn('ts-node', ['./src/crawl.ts', ...process.argv.slice(2)], {
            stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        });

        crawler_process.on('message', data => {
            console.log("received data from crawler_process: " + data);
            if (data === 'restart') {
                restart = true;
            }
        });
            
        crawler_process.on('close', code => {
            console.log(`crawler_process exited with code ${code}`);
            if (code != 0) {
                if (restart) {
                    resolve(true);
                }
            }
            resolve(false);
        });
    })
}

let mitmdumpEnabled = true;

(async () => {
    const jobName = process.argv[2];
    if (jobName === undefined) {
        console.log("Error: Must provide job name as argument");
        process.exit(1);
    }
    await fs.mkdir(`out/${jobName}`, { recursive: true });

    let mitmdump: Mitmdump;

    if (mitmdumpEnabled) {
        mitmdump = new Mitmdump(`out/${jobName}/mitmdump`);

        process.on('uncaughtExceptionMonitor', err => {
            if (mitmdump) {
                mitmdump.close();
            }
            crawler_process.kill();
        });

        await mitmdump.start();
    }

    while (await run_crawler() === true) {}

    if (mitmdumpEnabled) {
        await mitmdump.close();
    }

    console.log("Bye");
})();
