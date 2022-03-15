import { Warcprox } from './warcprox';
import { spawn } from 'child_process';

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

(async () => {
    const warcprox = new Warcprox();

    process.on('uncaughtExceptionMonitor', err => {
        warcprox.close();
        crawler_process.kill();
    });

    await warcprox.start();

    while (await run_crawler() === true) {}

    await warcprox.close();

    console.log("Bye");
})();
