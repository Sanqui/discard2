import { strict as assert } from 'assert';
import * as fs from 'fs/promises';

import * as puppeteer_types from 'puppeteer';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import pressAnyKey from 'press-any-key';

import { CaptureTool } from './captureTools/captureTools';

puppeteer.use(StealthPlugin());

const DISCARD_VERSION = '0.1.2';

type LogFunction = (...args: unknown[]) => Promise<void>;

export interface CrawlerInterface {
    log: LogFunction;
    page: puppeteer_types.Page;
}

export class Task {
    type: string;

    async perform(crawler: CrawlerInterface): Promise<Task[] | void> {
        return [];
    }
}

export type State = {
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
    settings: {
        resume: string,
        captureToolName: string,
        projectName: string,
        startingTasks: Task[],
        blockImages: boolean,
    },
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

interface CrawlerParams {
    project: Project,
    tasks: Task[],
    mode: string,
    outputDir?: string,
    browserDataDir?: string,
    headless?: boolean,
    captureTool: typeof CaptureTool,
    proxyServerAddress?: string,
    blockImages?: boolean,
    resume?: string,
}

export class Crawler {
    jobName: string;
    mode: string;
    browser: puppeteer_types.Browser;
    state: State;
    project: Project;
    dataPath: string;
    captureTool: CaptureTool;
    headless: boolean;
    tasks: Task[];
    browserDataDir: string | null;
    proxyServerAddress: string | null;
    blockImages?: boolean;
    resume: string

    constructor(params: CrawlerParams) {
        this.project = params.project;

        this.tasks = params.tasks;
        this.mode = params.mode;
        // set job name to UTC timestamp
        this.jobName = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + '-' + params.mode;
        this.dataPath = (params.outputDir || 'out') + `/${this.jobName}`;
        this.captureTool = new params.captureTool(this.dataPath);
        this.headless = params.headless || false;
        this.browserDataDir = params.browserDataDir;
        this.proxyServerAddress = params.proxyServerAddress;
        this.blockImages = params.blockImages;
        this.resume = params.resume;
    }
    
    async saveState() {
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
            settings: {
                resume: this.resume,
                captureToolName: this.captureTool.constructor.name,
                projectName: this.project.constructor.name,
                startingTasks: [],
                blockImages: this.blockImages
            },
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
        if (this.resume) {
            await this.log("Resuming from " + this.resume);

            const resumeState = JSON.parse(await fs.readFile(`${this.resume}/state.json`, 'utf8')) as State;

            for (const taskObj of [resumeState.tasks.current, ...resumeState.tasks.queued]) {
                const task = new this.project.taskClasses[taskObj.type];
                for (const key in taskObj) {
                    if (key !== 'type') {
                        task[key] = taskObj[key];
                    }
                }
                this.state.tasks.queued.push(task);
            }

            await this.log(`Queued ${this.state.tasks.queued.length} tasks from resumed job`);
        }

        await this.captureTool.start()

        // Check if we're running in Docker.
        // If yes, we'll need to pass the `--no-sandbox` flag.
        // This is not necessary in Podman.
        let runningInDocker = false;
        try {
            await fs.readFile("/.dockerenv");
            runningInDocker = true;
            await this.log("Running in Docker");
        } catch {}

        const proxyServerAddress = this.proxyServerAddress ?? this.captureTool.proxyServerAddress;

        this.browser = await puppeteer.launch({
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

            headless: this.headless,
            userDataDir: this.browserDataDir,
            env: {
                ...process.env,
                'TZ': 'Etc/UTC'
            }
        });
        const page = await this.browser.newPage();

        if (this.blockImages) {
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

        this.state.tasks.queued = [
            ...this.project.initialTasks,
            ...this.tasks,
            ...this.state.tasks.queued];
        
        this.state.settings.startingTasks = [...this.project.initialTasks];

        while (this.state.tasks.queued.length > 0) {
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
                if (!this.headless) {
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
        this.captureTool.close();
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