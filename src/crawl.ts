import { strict as assert } from 'assert';
import * as fs from 'fs/promises';

import * as puppeteer_types from 'puppeteer';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

import { CaptureTool } from './captureTools/captureTools';
//import { Mitmdump } from './captureTools/mitmdump';

puppeteer.use(StealthPlugin());

export class Task {
    async perform(page: puppeteer_types.Page): Promise<Task[] | void> {
        return [];
    }
}

export type State = {
    jobName: string,
    jobMode: string,
    jobStarted: Date,
    jobSaved: Date | null,
    jobFinished: Date | null,
    tasksQueued: Task[],
    currentTask: Task | null,
    tasksFinished: Task[],
    tasksFailed: Task[]
}

export interface Project {
    initialTasks: Task[], // runs even after restart
}

interface CrawlerParams {
    project: Project,
    tasks: Task[],
    mode: string,
    outputDir?: string,
    browserDataDir?: string,
    serverSideReplayFile?: string,
    headless?: boolean,
    captureTool: typeof CaptureTool
}

export class Crawler {
    jobName: string;
    mode: string;
    browser: puppeteer_types.Browser;
    state: State;
    project: Project;
    dataPath: string;
    captureTool: CaptureTool;
    startMitmdump: boolean = true;
    headless: boolean;
    tasks: Task[];

    constructor(params: CrawlerParams) {
        this.project = params.project;

        this.tasks = params.tasks;
        this.mode = params.mode;
        // set job name to UTC timestamp
        this.jobName = new Date().toISOString() + '-' + params.mode;
        this.dataPath = (params.outputDir || 'out') + `/${this.jobName}`;
        if (!params.serverSideReplayFile) {
            this.captureTool = new params.captureTool(this.dataPath + '/mitmdump');
        } else {
            this.captureTool= new params.captureTool(params.serverSideReplayFile, true);
        }
        this.headless = params.headless || false;
    }
    
    async saveState() {
        this.state.jobSaved = new Date();
        return await fs.writeFile(
            `${this.dataPath}/state.json`,
            JSON.stringify(this.state, null, 2),
            'utf8'
        );
    }

    async run() {
        try {
            throw new Error('Resuming a job is not currently implemented');
            let contents = await fs.readFile(`${this.dataPath}/state.json`, 'utf8');
            this.state = JSON.parse(contents);
            assert.equal(this.state.jobName, this.jobName);
            console.log("Restored job state");

            if (this.state.currentTask) {
                this.state.tasksQueued.unshift(this.state.currentTask);
                this.state.currentTask = null;
            }
        } catch (error) {
            this.state = {
                jobName: this.jobName,
                jobMode: this.mode,
                jobStarted: new Date(),
                jobSaved: null,
                jobFinished: null,
                tasksFailed: [],
                currentTask: null,
                tasksQueued: [],
                tasksFinished: []
            };
            console.log("Initiated new job state");

            await fs.mkdir(this.dataPath, { recursive: true });
        }

        await this.captureTool.start()

        // Check if we're running in Docker.
        // If yes, we'll need to pass the `--no-sandbox` flag.
        // This is not necessary in Podman.
        let runningInDocker = false;
        try {
            await fs.readFile("/.dockerenv");
            runningInDocker = true;
        } catch {}

        this.browser = await puppeteer.launch({
            args: [
                this.captureTool.proxyServerAddress ? `--proxy-server=${this.captureTool.proxyServerAddress}` : '',
                '--ignore-certificate-errors',
                '--disable-gpu',
                '--force-prefers-reduced-motion',
                runningInDocker ? '--no-sandbox' : '',
            //    `--ssl-key-log-file=${this.dataPath}/sslkeys.pms`
            ],
            // Remove "Chrome is being controlled by automated test software" banner,
            // but brings some caveats
            // see https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md#test--debugging-flags
            //ignoreDefaultArgs: ["--enable-automation"],

            headless: this.headless,
            userDataDir: process.env.BROWSER_DATA_DIR || undefined,
            env: {
                ...process.env,
                'TZ': 'Etc/UTC'
            }
        });
        const page = await this.browser.newPage();

        this.state.tasksQueued = [
            ...this.project.initialTasks,
            ...this.tasks,
            ...this.state.tasksQueued];

        while (this.state.tasksQueued.length > 0) {
            const task = this.state.tasksQueued.shift();
            this.state.currentTask = task;
            this.saveState();

            console.log(`*** Task: ${task.constructor.name} (${this.state.tasksQueued.length} more)`);

            let newTasks: Task[] | void;
            try {
                newTasks = await task.perform(page);
            } catch (error) {
                console.log("Caught error while performing task: " + error);
                await this.browser.close();
                await this.captureTool.close();
                throw error;
            }
            if (newTasks) {
                this.state.tasksQueued = [
                    ...newTasks,
                    ...this.state.tasksQueued
                ]
            }
            this.state.tasksFinished.push(task);
        }

        this.state.currentTask = null;

        console.log("All tasks completed")
        this.state.jobFinished = new Date();
        this.saveState();

        await this.browser.close();
        await this.captureTool.close();
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