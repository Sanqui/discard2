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
    constructor(
        public discordEmail?: string,
    ) {
        super();
    }

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
        await page.waitForSelector('#my-account-tab')

        const emailDivXpath = `//*[@id="my-account-tab"]//h5[contains(., 'Email')]/following-sibling::div[1]`;

        const [revealEmailButton] = await page.$x(
            emailDivXpath + `//button`
        );

        let email: string = null;
        for (let i = 0; i < 3; i++) {
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

        console.log("Email read as ", email);
        
        if (this.discordEmail) {
            if (email != this.discordEmail) {
                throw new Error(`Email in profile doesn't match provided email (${this.discordEmail}).`)
            }
        } else {
            console.log("No email to verify against.")
        }

        // close settings
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);
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
                let resultsText = await page.$eval(resultsSelector, el => el.textContent);
                if (resultsText.trim() != "Searching…") {
                    return resultsText;
                }

                await page.waitForTimeout(1_000);
                /*
                await page.evaluate((selector: string) => {
                    return new Promise<void>((resolve, reject) => {
                        let observer = new MutationObserver(() => {
                            observer.disconnect(); // use the mutation observer only once
                            resolve();
                        });
                        observer.observe(document.querySelector(selector), { childList: true, subtree: true, });
                
                        setTimeout(reject.bind(this, 'timeout'), 10_000);
                    });
                }, resultsSelector);
                */
            }
            throw Error("Did not get search results after 10 seconds.");
        }

        await performAndWaitForSearchResults(
            page.keyboard.press('Enter')
        );
        
        // Switch the order from oldest messages
        let results_text = await performAndWaitForSearchResults(
            page.click(`div[aria-controls="oldest-tab"]`)
        );

        console.log("Search results: " + results_text);

        if (results_text == "No Results") {
            // No search results match our criteria -- we're done scraping this channel
            return;
        }

        const firstResultSelector = `#search-results > ul > li:first-of-type`;
        let firstMessageId = await page.$eval(
            firstResultSelector,
            el => el.attributes['aria-labelledby'].value.split('-')[2]
        );

        console.log(`ID of first message in search results: ${firstMessageId}`);

        if (this.after) {
            if (firstMessageId < datetimeToDiscordSnowflake(this.after)) {
                throw Error("First message ID is less than the after date");
            }
        }

        await page.click(firstResultSelector);
        
        // Wait for the message to show up
        await page.waitForSelector(`#chat-messages-${firstMessageId}`);

        // Close the search results
        await page.click('[aria-label="Clear search"]');

        // scroll down and stop until we either hit the bottom or a message
        // that's after the after date

        let scrollTimes = 0;

        while (true) {
            const lastMessageSelector = `ol[data-list-id="chat-messages"] > li[id^="chat-messages"]:last-of-type`;
            let lastMessageId = await page.$eval(
                lastMessageSelector,
                el => el.attributes['id'].value.split('-')[2]
            );

            if (this.before) {
                if (lastMessageId >= datetimeToDiscordSnowflake(this.before)) {
                    console.log(`We have reached the last message we are interested in (ID ${lastMessageId})`);
                    break;
                }
            }

            if (!await page.$(`div[class^="jumpToPresentBar"`)) {
                console.log(`We have reached the last message ("Jump to Present" bar is not present)`);
                break;
            }

            console.log(`Scrolling to last message (ID ${lastMessageId})...`)
            await page.$eval(lastMessageSelector,
                el => el.scrollIntoView({ behavior: 'smooth', block: 'end'})
            );
            await page.waitForTimeout(1_000);
            scrollTimes += 1;
        }

        console.log(`Channel ${this.channelId} finished (scolled ${scrollTimes} times)`);

        //await page.waitForTimeout(15_000);
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
