import * as puppeteer_types from 'puppeteer';
import {retry, retryGoto, clickAndWaitForNavigation, getUrlsFromLinks} from './utils';
import {Project, Task} from './crawl';

const discord_url = new URL("https://discord.com/");

export class DiscordTask extends Task {
}

export class InitialDiscordTask extends DiscordTask {
    type = "InitialDiscordTask";
    async perform(page: puppeteer_types.Page) {
        await retryGoto(page, discord_url);
    }
}

export class LoginDiscordTask extends DiscordTask {
    type = "LoginDiscordTask";
    constructor(
        public discordEmail: string,
        public discordPassword: string
    ) {
        super();
    }

    async perform(page: puppeteer_types.Page) {
        await retryGoto(page, new URL("https://discord.com/login"));

        await page.waitForSelector("#app-mount")

        let this_ = this;
        async function fillInLoginForm() {
            console.log("Filling in login form")
            await page.type('input[name="email"]', this_.discordEmail);
            await page.type('input[name="password"]', this_.discordPassword);

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
    }
}

export class ProfileDiscordTask extends DiscordTask {
    type = "ProfileDiscordTask";
    async perform(page: puppeteer_types.Page) {
        await retry(
            async () => {
                await page.click('button[aria-label="User Settings"]')
                await page.waitForSelector("#my-account-tab", { timeout: 5000 })
            },
            3,
            "opening user settings"
        )
    }
}
    

export class DiscordProject implements Project {
    initialTasks: Task[];

    constructor(discordEmail: string, discordPassword: string) {
        if (!discordEmail || !discordPassword) {
            throw new Error("Discord email and password must be provided");
        }

        this.initialTasks = [
            new InitialDiscordTask(),
            new LoginDiscordTask(discordEmail, discordPassword)
        ];
    }
}
