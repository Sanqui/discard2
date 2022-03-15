import puppeteer from 'puppeteer';
import {retryGoto, clickAndWaitForNavigation, getUrlsFromLinks} from './utils';
import {Project} from './crawl';

const discord_url = new URL("https://discord.com/");

export enum TaskType {
    Initial = "initial",
    Login = "login",
}

export class DiscordProject implements Project {
    static readonly TaskType = TaskType;

    initialTask = {
        type: TaskType.Initial,
        url: discord_url
    }

    firstTask = this.initialTask

    taskFunctions = {
        [TaskType.Initial]: async (page: puppeteer.Page, url: URL) => {
            await retryGoto(page, url);
        
            await clickAndWaitForNavigation(page, 'a[href="//discord.com/login"]');

            return [];
        }
    }
}
