import * as puppeteer_types from 'puppeteer';
import dateFormat from "dateformat";

import {retry, retryGoto, clickAndWaitForNavigation, getUrlsFromLinks, waitForAndClick} from './utils';
import {Project, Task} from './crawl';

const discord_url = new URL("https://discord.com/");

function datetimeToDiscordSnowflake(date: Date) {
    return (BigInt(date.getTime()) - BigInt("1420070400000") << BigInt(22)).toString();
}

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

        await page.bringToFront();

        const this_ = this;
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
        const nameTag = await page.$eval('div[class^="nameTag"]', el => el.textContent);

        console.log("Logged in: " + nameTag);
        await page.waitForTimeout(1000);

        if (await page.$('form[class^="focusLock"]')) {
            console.log("Modal detected, attempting to close")
            await page.keyboard.press('Escape');
            await page.waitForTimeout(1000);
        }
    }
}

export class ProfileDiscordTask extends DiscordTask {
    type = "ProfileDiscordTask";
    constructor(
        public discordEmail?: string,
    ) {
        super();
    }

    async _openSettings(page: puppeteer_types.Page) {
        await retry(
            async () => {
                await page.click('button[aria-label="User Settings"]')
                await page.waitForSelector("#my-account-tab", { timeout: 5000 })
            },
            3,
            "opening user settings"
        )
        await page.waitForSelector('#my-account-tab')
    }

    async _closeSettings(page: puppeteer_types.Page) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
    }

    async _getEmail(page: puppeteer_types.Page): Promise<string> {
        const emailDivXpath = `//*[@id="my-account-tab"]//h5[contains(., 'Email')]/following-sibling::div[1]`;

        const [revealEmailButton] = await page.$x(
            emailDivXpath + `//button`
        );

        let email: string = null;
        for (let i = 0; i < 4; i++) {
            await revealEmailButton.click();

            email = await (await page.$x(
                emailDivXpath + `/span/text()`
            ))[0].evaluate(span => span.textContent.trim());

            if (email[0] != "*") {
                break;
            }
            await page.waitForTimeout(200);
        }
        if (!email || email[0] == "*") {
            throw new Error(`Failed to read email from profile.`);
        }

        return email;
    }

    async perform(page: puppeteer_types.Page) {
        await this._openSettings(page);

        const email = await this._getEmail(page);
        console.log("Email read as ", email);
        
        if (this.discordEmail) {
            if (email != this.discordEmail) {
                throw new Error(`Email in profile doesn't match provided email (${this.discordEmail}).`)
            }
        } else {
            console.log("No email to verify against.")
        }

        await this._closeSettings(page);
    }
}

export class ChannelDiscordTask extends DiscordTask {
    type = "ChannelDiscordTask";
    serverId: string;
    channelId: string;
    after?: Date;
    before?: Date;

    constructor(
        serverId: string,
        channelId: string,
        after?: Date | string,
        before?: Date | string,
    ) {
        super();
        this.serverId = serverId;
        this.channelId = channelId;

        this.after = typeof after == "string" ? new Date(after) : after;
        this.before = typeof before == "string" ? new Date(before) : before;
    }

    async _openChannel(page: puppeteer_types.Page) {
        await waitForAndClick(page, 
            `[data-list-item-id=guildsnav___${this.serverId}]`,
            `Server ID ${this.serverId} not found`
        );

        await waitForAndClick(page, 
            `[data-list-item-id=channels___${this.channelId}]`,
            `Channel ID ${this.channelId} not found`
        );

        console.log(`Channel ${this.channelId} opened`)
    }

    async _searchAndClickFirstResult(page: puppeteer_types.Page): Promise<string | void> {
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyF');
        await page.keyboard.up('Control');

        async function typeDateFilter(name: string, date: Date) {
            if (date) {
                return await page.keyboard.type(name + ':' + dateFormat(date, "yyyy-mm-dd"), {delay: 100});
            }
        }

        await typeDateFilter('after', this.after);
        await typeDateFilter('before', this.before);

        async function performAndWaitForSearchResults(action: Promise<void>) {
            const resultsSelector = 'div[class^="totalResults"] > div:first-child';
            await action;
            await page.waitForSelector(resultsSelector);

            for (let i = 0; i < 10; i++) {
                const resultsText = await page.$eval(resultsSelector, el => el.textContent);
                if (resultsText.trim() != "Searching…") {
                    return resultsText;
                }

                await page.waitForTimeout(1_000);
            }
            throw Error("Did not get search results after 10 seconds.");
        }

        await performAndWaitForSearchResults(
            page.keyboard.press('Enter')
        );
        
        // Switch the order from oldest messages
        const results_text = await performAndWaitForSearchResults(
            page.click(`div[aria-controls="oldest-tab"]`)
        );

        console.log("Search results: " + results_text);

        if (results_text == "No Results") {
            // No search results match our criteria -- we're done scraping this channel
            return;
        }

        const firstResultSelector = `#search-results > ul > li:first-of-type`;
        const firstMessageId = await page.$eval(
            firstResultSelector,
            el => el.attributes['aria-labelledby'].value.split('-')[2]
        ) as string;

        console.log(`ID of first message in search results: ${firstMessageId}`);

        if (this.after) {
            if (BigInt(firstMessageId) < BigInt(datetimeToDiscordSnowflake(this.after))) {
                throw Error("First message ID is less than the after date");
            }
        }

        await page.click(firstResultSelector);
        
        // Wait for the message to show up
        await page.waitForSelector(`#chat-messages-${firstMessageId}`);

        // Close the search results
        await page.click('[aria-label="Clear search"]');

        return firstMessageId;
    }

    async _scrollChat(page: puppeteer_types.Page) {
        // scroll down and stop until we either hit the bottom or a message
        // that's after the after date

        let scrollTimes = 0;

        while (true) {
            const messageSelector = `ol[data-list-id="chat-messages"] li[id^="chat-messages"]`;
            const messageIds = await page.$$eval(messageSelector, els => els.map(el => el.id.split('-')[2]));
            const lastMessageId = messageIds[messageIds.length - 1];

            if (this.before) {
                if (BigInt(lastMessageId) >= BigInt(datetimeToDiscordSnowflake(this.before))) {
                    console.log(`We have reached the last message we are interested in (ID ${lastMessageId})`);
                    break;
                }
            }

            if (!await page.$(`div[class^="jumpToPresentBar"`)) {
                console.log(`We have reached the last message ("Jump to Present" bar is not present)`);
                break;
            }

            console.log(`Scrolling to last message (ID ${lastMessageId})...`)
            await page.$eval(`#chat-messages-${lastMessageId}`,
                el => el.scrollIntoView({ behavior: 'smooth', block: 'end'})
            );
            await page.waitForTimeout(1_000);
            scrollTimes += 1;
        }

        console.log(`Channel ${this.channelId} finished (scolled ${scrollTimes} times)`);
    }

    async perform(page: puppeteer_types.Page) {
        await this._openChannel(page);

        const firstMessageId = await this._searchAndClickFirstResult(page);

        if (!firstMessageId) return;

        await this._scrollChat(page);

        //await page.waitForTimeout(15_000);
    }
}


export class ServerDiscordTask extends DiscordTask {
    type = "ServerDiscordTask";
    after?: Date;
    before?: Date;

    constructor(
        public serverId: string,
        after?: Date | string,
        before?: Date | string,
    ) {
        super();

        this.after = typeof after == "string" ? new Date(after) : after;
        this.before = typeof before == "string" ? new Date(before) : before;
    }

    async perform(page: puppeteer_types.Page) {
        await waitForAndClick(page, 
            `[data-list-item-id=guildsnav___${this.serverId}]`,
            `Server ID ${this.serverId} not found`
        );
        // TODO wait for/verify that the server has loaded
        // perhaps by verifying its name against the title of the icon
        await page.waitForTimeout(1_500);

        // Make sure all categories are open  

        for await(const el of await page.$$('#channels ul li [class*="collapsed-"]')) {
            await el.click();
            // TODO await properly for the category to be expanded
            await page.waitForTimeout(200);
        }
        
        // Return a list of tasks for each channel
        const channels = await page.$$('#channels ul li a[role="link"]');

        console.log(`Discovered ${channels.length} channels, creating tasks`);
        
        return await Promise.all(
            channels.map(async (el) => {
                const channelId = await el.evaluate(el => el.attributes['data-list-item-id'].value.split('_')[3]);
                return new ChannelDiscordTask(this.serverId, channelId, this.after, this.before);
            })
        );
    }
}
    

export class DiscordProject implements Project {
    initialTasks: Task[];

    constructor(discordEmail: string, discordPassword: string) {
        if (!discordEmail || !discordPassword) {
            throw new Error("Discord email and password must be provided");
        }

        this.initialTasks = [
            //new InitialDiscordTask(),
            new LoginDiscordTask(discordEmail, discordPassword),
            new ProfileDiscordTask(discordEmail)
        ];
    }
}
