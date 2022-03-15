import * as puppeteer_types from 'puppeteer';
import {retryGoto, clickAndWaitForNavigation, getUrlsFromLinks} from './utils';
import {Project, Task, TaskType} from './crawl';

const discord_url = new URL("https://discord.com/");

export enum DiscordTaskType {
    Initial = "initial",
    Login = "login",
    Profile = "profile",
}

export class DiscordTask implements Task {
    type: TaskType
    url?: URL
}

export class DiscordProject implements Project {
    static readonly TaskType = DiscordTaskType;

    initialTask = {
        type: DiscordTaskType.Initial,
        url: discord_url
    }

    modeTasks = {
        "profile": {type: DiscordTaskType.Profile}
    }

    taskFunctions = {
        [DiscordTaskType.Initial]: async (page: puppeteer_types.Page, url: URL) => {
            await retryGoto(page, url);
        
            await clickAndWaitForNavigation(page, 'a[href="//discord.com/login"]');

            return [{type: DiscordTaskType.Login, url: new URL(page.url())}];
        },
        [DiscordTaskType.Login]: async (page: puppeteer_types.Page, url: URL) => {
            //await retryGoto(page, url);

            await page.type('input[name="email"]', process.env.DISCORD_EMAIL);
            await page.type('input[name="password"]', process.env.DISCORD_PASSWORD);

            await clickAndWaitForNavigation(page, 'button[type="submit"]')

            await page.waitForSelector('div[class^="nameTag"]')
            let nameTag = await page.$eval('div[class^="nameTag"]', el => el.textContent);

            console.log("Logged in: " + nameTag);

            return []
        },
        [DiscordTaskType.Profile]: async (page: puppeteer_types.Page) => {
            await page.click('button[aria-label="User Settings"]')

            await page.waitForSelector("#my-account-tab")

            return []
        }
    }
}
