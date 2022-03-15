import { strict as assert } from 'assert';
import * as fs from 'fs/promises';

import dotenv from 'dotenv';
import * as puppeteer_types from 'puppeteer';
import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

import { DiscordProject } from './discord';

dotenv.config();

puppeteer.use(StealthPlugin());

export interface Task {
    type: string,
    url?: URL
}

export type State = {
    jobName: string,
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
    taskFunctions: {
        [index in string]: (page: puppeteer_types.Page, url: URL) => Promise<Task[]>
    }
}

class Crawler {
    jobName: string;
    browser: puppeteer_types.Browser;
    state: State;
    project: Project;
    dataPath: string;

    constructor(jobName: string, project: Project) {
        this.project = project;
        this.jobName = jobName;
        this.dataPath = `out/${this.jobName}`;
    }
    
    async saveState() {
        this.state.jobSaved = new Date();
        return await fs.writeFile(
            `${this.dataPath}/state.json`,
            JSON.stringify(this.state,
                (key, value) => {
                    if (key === 'page') {
                        return null;
                    }
                    return value;
                }
            ),
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

        this.browser = await puppeteer.launch({
            args: [
                '--proxy-server=127.0.0.1:8080',
                '--ignore-certificate-errors',
                '--disable-gpu',
                `--ssl-key-log-file=${this.dataPath}/sslkeys.pms`
            ],
            // Remove "Chrome is being controlled by automated test software" banner,
            // but brings some caveats
            // see https://github.com/GoogleChrome/chrome-launcher/blob/master/docs/chrome-flags-for-tools.md#test--debugging-flags
            //ignoreDefaultArgs: ["--enable-automation"],

            headless: false
        });
        const page = await this.browser.newPage();

        this.state.tasksQueued.unshift(this.project.initialTask);

        while (this.state.tasksQueued.length > 0) {
            const task = this.state.tasksQueued.shift();
            this.state.currentTask = task;
            this.saveState();

            console.log(`Task: ${task.type} ${task.url} (${this.state.tasksQueued.length} more)`);

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
    }
}

(async () => {
    const jobName = process.argv[2];
    if (jobName === undefined) {
        console.log("Error: Must provide job name as argument");
        process.exit(1);
    }

    if (!process.env.DISCORD_EMAIL && !process.env.DISCORD_PASSWORD) {
        console.log("Error: Must provide DISCORD_EMAIL and DISCORD_PASSWORD env variables (you may use a .env file)");
        process.exit(1);
    }

    const crawler = new Crawler(
        jobName,
        new DiscordProject()
    );

    process.on('uncaughtExceptionMonitor', err => {
        // We cannot recover from this error, but Puppeteer sometimes throws it.
        // At least let the parent process know it should restart.
        if (err.message === "We either navigate top level or have old version of the navigated frame") {
            console.log("Monitored known Puppeteer error: " + err.message);
            process.send && process.send('restart');
        }
    });

    await crawler.run();
})();
