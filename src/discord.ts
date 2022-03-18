import * as puppeteer_types from 'puppeteer';
import {retry, retryGoto, clickAndWaitForNavigation, getUrlsFromLinks, waitForAndClick} from './utils';
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
        await page.waitForTimeout(1000);
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

export class ChannelDiscordTask extends DiscordTask {
    type = "ChannelDiscordTask";
    constructor(
        public serverId: string,
        public channelId: string,
        public after?: string,
        public before?: string,
    ) {
        super();
    }

    async perform(page: puppeteer_types.Page) {
        await waitForAndClick(page, 
            `[data-list-item-id=guildsnav___${this.serverId}]`,
            `Server ID ${this.serverId} not found`
        );

        await waitForAndClick(page, 
            `[data-list-item-id=channels___${this.channelId}]`,
            `Channel ID ${this.channelId} not found`
        );

        console.log(`Channel ${this.channelId} opened`)

        await page.keyboard.down('Control');
        await page.keyboard.press('KeyF');
        await page.keyboard.up('Control');

        console.log("after: " + this.after)
        console.log("before: " + this.before)
        if (this.after) {
            await page.keyboard.type('after:' + this.after, {delay: 100});
        }
        if (this.before) {
            await page.keyboard.type('before:' + this.before, {delay: 100});
        }

        await page.keyboard.press('Enter');

        await waitForAndClick(page, 
            `div[aria-controls="oldest-tab"]`,
            `"Oldest" tab in search didn't show up`
        );

        await page.waitForTimeout(500);

        await page.click(`div[aria-controls="oldest-tab"]`);

        console.log("Performed search");

        await page.waitForTimeout(5000);

        // TODO iterate over more messages
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
