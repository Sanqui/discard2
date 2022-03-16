import { strict as assert } from 'assert';
import * as fs from 'fs/promises';

import * as puppeteer_types from 'puppeteer';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

import { Mitmdump } from './mitmdump';

puppeteer.use(StealthPlugin());

export type TaskType = Readonly<string | number>;

export interface Task {
    type: TaskType,
    url?: URL
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
    initialTask: Task, // runs even after restart
    modeTasks: {
        [index in string]: Task
    }
    taskFunctions: {
        [index in TaskType]: (page: puppeteer_types.Page, url: URL) => Promise<Task[]>
    }
}

export class Crawler {
    jobName: string;
    mode: string;
    browser: puppeteer_types.Browser;
    state: State;
    project: Project;
    dataPath: string;
    mitmdump: Mitmdump;

    constructor(project: Project, mode: string, browserDataDir: string) {
        this.project = project;

        if (!(mode in this.project.modeTasks)) {
            console.log("Error: Mode must be one of: " + Object.keys(this.project.modeTasks));
            process.exit(1);
        }
        this.mode = mode;
        // set job name to UTC timestamp
        this.jobName = new Date().toISOString() + '-' + mode;
        this.dataPath = `out/${this.jobName}`;
        this.mitmdump = new Mitmdump(this.dataPath + '/mitmdump');
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

        await this.mitmdump.start()

        this.browser = await puppeteer.launch({
            args: [
                '--proxy-server=127.0.0.1:8080',
                '--ignore-certificate-errors',
                '--disable-gpu',
            //    `--ssl-key-log-file=${this.dataPath}/sslkeys.pms`
            ],
            // Remove "Chrome is being controlled by automated test software" banner,
            // but brings some caveats
            // see https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md#test--debugging-flags
            //ignoreDefaultArgs: ["--enable-automation"],

            headless: false,
            userDataDir: process.env.BROWSER_DATA_DIR
        });
        const page = await this.browser.newPage();

        this.state.tasksQueued.unshift(this.project.modeTasks[this.mode]);

        this.state.tasksQueued.unshift(this.project.initialTask);

        while (this.state.tasksQueued.length > 0) {
            const task = this.state.tasksQueued.shift();
            this.state.currentTask = task;
            this.saveState();

            console.log(`*** Task: ${task.type} (${this.state.tasksQueued.length} more)`);

            let newTasks = await this.project.taskFunctions[task.type](page, task.url);
            this.state.tasksQueued = [
                ...newTasks,
                ...this.state.tasksQueued
            ]
            this.state.tasksFinished.push(task);
        }

        this.state.currentTask = null;

        console.log("All tasks completed")

        this.state.jobFinished = new Date();
        this.saveState();

        await this.browser.close();
        await this.mitmdump.close();
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