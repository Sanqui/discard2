import * as puppeteer_types from 'puppeteer';
import {retryGoto, clickAndWaitForNavigation, getUrlsFromLinks} from './utils';
import {Project, Task} from './crawl';

const discord_url = new URL("https://discord.com/");

export enum TaskType {
    Initial = "initial",
    Login = "login",
}

export class DiscordTask implements Task {
    type: TaskType
    url?: URL
}

export class DiscordProject implements Project {
    static readonly TaskType = TaskType;

    initialTask = {
        type: TaskType.Initial,
        url: discord_url
    }

    taskFunctions = {
        [TaskType.Initial]: async (page: puppeteer_types.Page, url: URL) => {
            await retryGoto(page, url);
        
            await clickAndWaitForNavigation(page, 'a[href="//discord.com/login"]');

            return [{type: TaskType.Login, url: new URL(page.url())}];
        },
        [TaskType.Login]: async (page: puppeteer_types.Page, url: URL) => {
            await retryGoto(page, url);

            await page.type('input[name="email"]', process.env.DISCORD_EMAIL);
            await page.type('input[name="password"]', process.env.DISCORD_PASSWORD);

            await clickAndWaitForNavigation(page, 'button[type="submit"]')

            await page.waitForSelector('div[clas^="nameTag"]')
            let nameTag = await page.$eval('div[clas^="nameTag"]', el => el.textContent);

            console.log("Logged in: " + nameTag);

            return []
        }
    }
}
