import * as puppeteer_types from 'puppeteer';
import {retry, retryGoto, clickAndWaitForNavigation, getUrlsFromLinks} from './utils';
import {Project, Task, TaskType} from './crawl';

const discord_url = new URL("https://discord.com/");

export enum DiscordTaskType {
    Initial = "initial",
    Login = "login",
    Profile = "profile",
}

export class DiscordTask implements Task {
    type: DiscordTaskType
    url?: URL
}

export class DiscordProject implements Project {
    static readonly TaskType = DiscordTaskType;

    initialTask = {
        type: DiscordTaskType.Initial
    }

    modeTasks = {
        "profile": {type: DiscordTaskType.Profile}
    }

    taskFunctions = {
        [DiscordTaskType.Initial]: async (page: puppeteer_types.Page) => {
            await retryGoto(page, discord_url);

            return [{type: DiscordTaskType.Login}];
        },
        [DiscordTaskType.Login]: async (page: puppeteer_types.Page) => {
            await retryGoto(page, new URL("https://discord.com/login"));

            await page.waitForSelector("#app-mount")

            async function fillInLoginForm() {
                console.log("Filling in login form")
                await page.type('input[name="email"]', process.env.DISCORD_EMAIL);
                await page.type('input[name="password"]', process.env.DISCORD_PASSWORD);

                await clickAndWaitForNavigation(page, 'button[type="submit"]')
            }

            if (await page.$('form[class^="authBox"]')) {
                await fillInLoginForm();
            } else if (await page.$('[class*="chooseAccountAuthBox"]')) {
                console.log("Encountered 'Choose an account' screen")
                await page.click('[class*="chooseAccountAuthBox"] [class^="actions"] button')

                await fillInLoginForm();

            } else if (await page.$('form[class^="nameTag"]')) {
                console.log("Already logged in")
            }

            await page.waitForSelector('div[class^="nameTag"]')
            let nameTag = await page.$eval('div[class^="nameTag"]', el => el.textContent);

            console.log("Logged in: " + nameTag);

            return []
        },
        [DiscordTaskType.Profile]: async (page: puppeteer_types.Page) => {
            await retry(
                async () => {
                    await page.click('button[aria-label="User Settings"]')
                    await page.waitForSelector("#my-account-tab", { timeout: 5000 })
                },
                3,
                "opening user settings"
            )

            return []
        }
    }
}
