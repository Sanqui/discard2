import { strict as assert } from 'assert';
import puppeteer from 'puppeteer';
import * as fs from 'fs/promises';
import { DiscordProject } from './discord';

export interface Task {
    type: string,
    url: URL
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
    firstTask: Task // first task to run
    taskFunctions: {
        [index in string]: (page: puppeteer.Page, url: URL) => Promise<Task[]>
    }
}

class Crawler {
    jobName: string;
    browser: puppeteer.Browser;
    state: State;
    project: Project;

    constructor(jobName: string, project: Project) {
        this.project = project;
        this.jobName = jobName;
    }
    
    async saveState() {
        this.state.jobSaved = new Date();
        return await fs.writeFile(
            `out/${this.jobName}/state.json`,
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
            let contents = await fs.readFile(`out/${this.jobName}/state.json`, 'utf8');
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
            
            this.state.tasksQueued.push(this.project.firstTask);

            await fs.mkdir(`out/${this.jobName}`, { recursive: true });
        }

        this.browser = await puppeteer.launch({
            args: [
                '--proxy-server=127.0.0.1:8000',
                '--ignore-certificate-errors',
                '--disable-gpu'
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
        console.log("Must provide job name as argument");
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
