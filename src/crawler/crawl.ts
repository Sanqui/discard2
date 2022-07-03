import { strict as assert } from 'assert';
import * as fs from 'fs/promises';

import * as puppeteer_types from 'puppeteer';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import pressAnyKey from 'press-any-key';
import pidusage from 'pidusage'

import { CaptureTool } from '../captureTools';

puppeteer.use(StealthPlugin());

const DISCARD_VERSION = '0.1.10-wip';

type LogFunction = (...args: unknown[]) => Promise<void>;

export interface CrawlerInterface {
    log: LogFunction;
    page: puppeteer_types.Page;
}

export class Task {
    type: string;

    result: object;

    constructor() {
        this.result = {};
    }

    async perform(crawler: CrawlerInterface): Promise<Task[] | void> {
        return [];
    }
}

export type CrawlerState = {
    datetimeSaved: string,
    client: {
        name: "discard2",
        version: string,
    },
    job: {
        datetimeStart: string,
        datetimeEnd: string,
        name: string,
        completed: boolean,
        error: boolean,
        errorMessage?: string,
    },
    settings: CrawlerSettings,
    tasks: {
        queued: Task[],
        current: Task | null,
        finished: Task[],
        failed: Task[],
    }
}

export interface Project {
    taskClasses: {
        [type: string]: any,
    };
    initialTasks: Task[], // runs even after restart
}

interface CrawlerSettings {
    project: Project,
    tasks: Task[],
    mode: string,
    outputDir?: string,
    browserDataDir?: string,
    headless?: boolean,
    captureTool: typeof CaptureTool,
    captureToolName?: string,
    proxyServerAddress?: string,
    blockImages?: boolean,
    resume?: string,
    tz?: string,
    browserRestartInterval?: number
}

export class Crawler {
    settings: CrawlerSettings;
    state: CrawlerState;

    jobName: string;
    dataPath: string;
    browser: puppeteer_types.Browser;
    browserLaunched: Date;
    captureTool: CaptureTool;

    constructor(settings: CrawlerSettings) {
        this.settings = settings;
        this.settings.tz = 'Etc/UTC';
        // set job name to UTC timestamp
        this.jobName = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + '-' + settings.mode;
        this.dataPath = (settings.outputDir || 'out') + `/${this.jobName}`;
        this.captureTool = new settings.captureTool(this.dataPath);
    }

    async saveState() {
        this.state.settings.captureToolName = this.captureTool.name;
        this.state.datetimeSaved = new Date().toISOString();
        return await fs.writeFile(
            `${this.dataPath}/state.json`,
            JSON.stringify(this.state, null, 2),
            'utf8'
        );
    }

    async log(...args: unknown[]) {
        console.log(...args);
        return await fs.appendFile(
            `${this.dataPath}/log.txt`,
            `${new Date().toISOString()}: ${Array.from(args).join(' ')}\n`,
            'utf8'
        );
    }

    async logPidusage() {
        if (this.browser && this.browser.process() && this.browser.process().pid) {
            const stats = await pidusage(this.browser.process().pid);
            const entry = {
                'datetime': new Date().toISOString(),
                'browser': stats
            }
            await fs.appendFile(
                `${this.dataPath}/pidusage.jsonl`,
                JSON.stringify(entry) + "\n",
                'utf8'
            );
            return true;
        }
        return false;
    }

    async launchBrowser(): Promise<[puppeteer_types.Browser, puppeteer_types.Page]> {
        // Check if we're running in Docker.
        // If yes, we'll need to pass the `--no-sandbox` flag.
        // This is not necessary in Podman.
        let runningInDocker = false;
        try {
            await fs.readFile("/.dockerenv");
            runningInDocker = true;
            await this.log("Running in Docker");
        } catch {}

        const proxyServerAddress = this.settings.proxyServerAddress ?? this.captureTool.proxyServerAddress;

        this.browserLaunched = new Date();
        const browser = await puppeteer.launch({
            product: "chrome",
            args: [
                proxyServerAddress ? `--proxy-server=${proxyServerAddress}` : '',
                proxyServerAddress ? '--ignore-certificate-errors' : '',
                '--disable-gpu',
                '--force-prefers-reduced-motion',
                runningInDocker ? '--no-sandbox' : '',
                `--ssl-key-log-file=${this.dataPath}/sslkeys.pms`,
                // Wireshark and other tools can't yet decrypt QUIC yet
                '--disable-quic'
            ],
            // Remove "Chrome is being controlled by automated test software" banner,
            // but brings some caveats
            // see https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md#test--debugging-flags
            //ignoreDefaultArgs: ["--enable-automation"],

            headless: this.settings.headless || false,
            userDataDir: this.settings.browserDataDir,
            env: {
                ...process.env, // TODO this should probably be written in the state file
                'TZ': this.settings.tz
            }
        });
        const page = await browser.newPage();
        page.on('error', (err) => {
            void this.log(`Page error: ${err}`);
            throw new Error(`Page error: ${err}`);
            // TODO proper handling (restart current task or crash)
        });

        if (this.settings.blockImages) {
            await page.setRequestInterception(true);
            page.on('request', (request) => {
                if (request.resourceType() === 'image') {
                    void request.abort();
                }
                else {
                    void request.continue();
                }
            });
        }

        try {
            await page.goto("http://x-determine-client-address.invalid", {timeout: 100});
        } catch {}

        await page.bringToFront();

        return [browser, page];
    }

    async run() {
        this.state = {
            datetimeSaved: null,
            client: {
                name: "discard2",
                version: DISCARD_VERSION,
            },
            job: {
                datetimeStart: new Date().toISOString(),
                datetimeEnd: null,
                name: this.jobName,
                completed: false,
                error: false,
            },
            settings: this.settings,
            tasks: {
                finished: [],
                failed: [],
                current: null,
                queued: [],
            }
        };
        await fs.mkdir(this.dataPath, { recursive: true });
        await this.saveState();
        await this.log("Initiated new job state name " + this.jobName);
        if (this.settings.resume) {
            await this.log("Resuming from " + this.settings.resume);

            const resumeState = JSON.parse(await fs.readFile(`${this.settings.resume}/state.json`, 'utf8')) as CrawlerState;

            for (const taskObj of [resumeState.tasks.current, ...resumeState.tasks.queued]) {
                if (!(taskObj.type in this.settings.project.taskClasses)) {
                    throw Error(`Task type ${taskObj.type} not found in project`);
                }
                const task = new this.settings.project.taskClasses[taskObj.type];
                for (const key in taskObj) {
                    if (key !== 'type') {
                        task[key] = taskObj[key];
                    }
                }
                // Throw away previous result
                task.result = {};
                this.state.tasks.queued.push(task);
            }

            await this.log(`Queued ${this.state.tasks.queued.length} tasks from resumed job`);
        }

        await this.captureTool.start()

        let page: puppeteer_types.Page;
        [this.browser, page] = await this.launchBrowser()

        let pidusageTimeout: NodeJS.Timeout;
        
        const pidusageInterval = async (time: number) => {
            while (true) {
                let result = await this.logPidusage();
                if (result) {
                    await new Promise(resolve => pidusageTimeout = setTimeout(resolve, time));
                }
            }
        }
        
        // Save browser CPU/ram usage every 30 seconds
        void pidusageInterval(30_000)
  

        this.state.tasks.queued = [
            ...this.settings.project.initialTasks,
            ...this.settings.tasks,
            ...this.state.tasks.queued];

        // this.state.settings.startingTasks = [...this.project.initialTasks];

        while (this.state.tasks.queued.length > 0) {
            // Restart browser if necessary
            if (this.settings.browserRestartInterval) {
                const dateRestart = new Date(this.browserLaunched.getTime() + this.settings.browserRestartInterval*60000);
                if (new Date() >= dateRestart) {
                    await this.log(`Restarting browser after ${this.settings.browserRestartInterval} min`)
                    await this.browser.close();
                    [this.browser, page] = await this.launchBrowser();
                    
                    // requeue initial tasks
                    this.state.tasks.queued = [
                        ...this.settings.project.initialTasks,
                        ...this.state.tasks.queued];
                }
            }

            const task = this.state.tasks.queued.shift();
            this.state.tasks.current = task;
            await this.saveState();

            await this.log(`*** Task: ${task.constructor.name} (${this.state.tasks.queued.length} more)`);

            let newTasks: Task[] | void;
            try {
                newTasks = await task.perform({log: this.log.bind(this) as LogFunction, page: page});
            } catch (error) {
                await this.log(`Caught error while performing task: ${error}`);
                const screenshotPath = `${this.dataPath}/error.png`;
                await page.screenshot({path: screenshotPath});
                await this.log(`Saved screenshot to ${screenshotPath}`);
                if (!this.settings.headless) {
                    await pressAnyKey("Press any key to exit...");
                }
                await this.browser.close();
                this.captureTool.close();
                this.state.job.error = true;
                this.state.job.errorMessage = error.toString() as string;
                await this.saveState();
                throw error;
            }
            if (newTasks) {
                this.state.tasks.queued = [
                    ...newTasks,
                    ...this.state.tasks.queued
                ]
            }
            this.state.tasks.finished.push(task);
        }

        this.state.tasks.current = null;

        await this.log("All tasks completed")
        this.state.job.datetimeEnd = new Date().toISOString();
        this.state.job.completed = true;
        await this.saveState();

        await this.browser.close();
        this.browser = null;
        clearTimeout(pidusageTimeout);

        this.captureTool.close();

        await this.log("Exiting crawler");
    }
}

/*(async () => {
    process.on('uncaughtExceptionMonitor', err => {
        // We cannot recover from this error, but Puppeteer sometimes throws it.
        // At least let the parent process know it should restart.
        if (err.message === "We either navigate top level or have old version of the navigated frame") {
            console.log("Monitored known Puppeteer error: " + err.message);
            process.send && process.send('restart');
        }
    });

    try {
        await crawler.run();
    } catch (error) {
        console.log("Caught error: " + error.message);
        await pressAnyKey("Press any key to exit...");
        throw error;
    }
})();
*/
