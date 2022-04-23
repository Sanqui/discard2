import * as puppeteer_types from 'puppeteer';
import dateFormat from "dateformat";
import cliProgress from 'cli-progress';

import {retry, retryGoto, clickAndWaitForNavigation, getUrlsFromLinks, waitForAndClick, waitForUrlStartsWith} from './utils';
import {Project, Task, CrawlerInterface, Crawler} from './crawl';

const discord_url = new URL("https://discord.com/");

function datetimeToDiscordSnowflake(date: Date) {
    return (BigInt(date.getTime()) - BigInt("1420070400000") << BigInt(22)).toString();
}

export class DiscordTask extends Task {
}

export class InitialDiscordTask extends DiscordTask {
    type = "InitialDiscordTask";
    async perform(crawler: CrawlerInterface) {
        await retryGoto(crawler.page, discord_url);
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

    async perform(crawler: CrawlerInterface) {
        await crawler.page.bringToFront();
        
        await retryGoto(crawler.page, new URL("https://discord.com/login"));

        await crawler.page.waitForSelector("#app-mount")

        await crawler.page.bringToFront();

        const this_ = this;
        async function fillInLoginForm() {
            await crawler.log("Filling in login form")
            await crawler.page.type('input[name="email"]', this_.discordEmail);
            await crawler.page.type('input[name="password"]', this_.discordPassword);


            const captchaSelector = 'iframe[src*="captcha/"]';
            await Promise.race([
                Promise.all([
                    crawler.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000}),
                    crawler.page.click('button[type="submit"]')
                ]),
                crawler.page.waitForSelector(captchaSelector)
            ]);
            
            if (await crawler.page.$(captchaSelector)) {
                throw new Error("Captcha detected on login.  It is recommended you log into this account manually in a browser from the same IP.")
            }
        }

        if (await crawler.page.$('form[class^="authBox"]')) {
            await fillInLoginForm();
        } else if (await crawler.page.$('[class*="chooseAccountAuthBox"]')) {
            await crawler.log("Encountered 'Choose an account' screen")
            await crawler.page.click('[class*="chooseAccountAuthBox"] [class^="actions"] button[class*="lookLink"]')

            await fillInLoginForm();

        } else if (await crawler.page.$('form[class^="nameTag"]')) {
            await crawler.log("Already logged in")
        }

        await crawler.page.waitForSelector('div[class^="nameTag"]')
        const nameTag = await crawler.page.$eval('div[class^="nameTag"]', el => el.textContent);

        await crawler.log("Logged in: " + nameTag);
        await crawler.page.waitForTimeout(1000);

        if (await crawler.page.$('form[class^="focusLock"]')) {
            await crawler.log("Modal detected, attempting to close")
            await crawler.page.keyboard.press('Escape');
            await crawler.page.waitForTimeout(1000);
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

    async perform(crawler: CrawlerInterface) {
        await this._openSettings(crawler.page);

        const email = await this._getEmail(crawler.page);
        await crawler.log("Email read as ", email);
        
        if (this.discordEmail) {
            if (email != this.discordEmail) {
                throw new Error(`Email in profile doesn't match provided email (${this.discordEmail}).`)
            }
        } else {
            await crawler.log("No email to verify against.")
        }

        await this._closeSettings(crawler.page);
    }
}

async function openServer(page: puppeteer_types.Page, serverId: string) {
    const channelLinkSelector = `#channels ul li a[href^="/channels/${serverId}"]`;
    
    if (await page.$(channelLinkSelector)) {
        // This server is already open
    } else {
        await waitForAndClick(page, 
            `[data-list-item-id=guildsnav___${serverId}]`,
            `Server ID ${serverId} not found`
        );

        // Wait for a single channel link with this server ID to appear
        // TODO: This may fail on servers without any available channel.

        await page.waitForSelector(`#channels ul li a[href^="/channels/${serverId}"]`);
    }

    // Make sure all categories are expanded  

    for await(const el of await page.$$('#channels ul li [class*="collapsed-"]')) {
        await el.click();
        // TODO await properly for the category to be expanded
        await page.waitForTimeout(200);
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

    async _openChannel(crawler: CrawlerInterface) {
        await openServer(crawler.page, this.serverId);

        const channelLinkSelector = `#channels ul li [data-list-item-id=channels___${this.channelId}]`;

        if (!await crawler.page.$(channelLinkSelector)) {
            throw Error(`Channel ID ${this.channelId} not found`);
        }

        // We need to scroll because of the "New unreads" indicator

        await crawler.page.$eval(channelLinkSelector,
            el => el.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"})
        );

        await retry(async () => {
            await crawler.page.click(channelLinkSelector, { delay: 50 });
            await crawler.page.waitForSelector(`[data-list-id="members-${this.channelId}"]`, { timeout: 200 });
        }, 10, "opening channel");

        await crawler.log(`Channel ${this.channelId} opened`)
    }

    async _pressCtrlF(page: puppeteer_types.Page) {
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyF');
        await page.keyboard.up('Control');
    }

    async _searchAndClickFirstResult(crawler: CrawlerInterface): Promise<[string, number] | void> {
        await this._pressCtrlF(crawler.page);

        async function typeDateFilter(name: string, date: Date) {
            if (date) {
                const el = await crawler.page.$('div[aria-label="Search"]');
                await el.type(name + ':' + dateFormat(date, "yyyy-mm-dd"), {delay: 25});
            }
        }

        await typeDateFilter('after', this.after);
        await typeDateFilter('before', this.before);

        const performAndWaitForSearchResults = async (action: Promise<void>): Promise<string> => {
            const resultsSelector = 'div[class^="totalResults"] > div:first-child';
            let searchFinished = false;
            let resultsText: string;

            await action;
            while (!searchFinished) {
                await crawler.page.waitForSelector(resultsSelector);

                const interval = 200;
                for (let i = 0; i < 10_000/interval; i++) {
                    resultsText = await crawler.page.$eval(resultsSelector, el => el.textContent);
                    if (!["Searching…", "Indexing…"].includes(resultsText.trim())) {
                        searchFinished = true;
                        break;
                    }

                    await crawler.page.waitForTimeout(interval);
                }
                if (searchFinished) {
                    // We're either going to get the search results, or an error
                    const el = await Promise.race([
                        crawler.page.waitForSelector('#search-results'),
                        crawler.page.waitForSelector('section[class^="searchResults"] div[class^="emptyResults"]')
                    ])
                    if (await crawler.page.$('#search-results')) {
                        // We got the results
                        return resultsText;
                    } else {
                        const errorEl = await el.$('div[class*="errorMessage"]');
                        if (!errorEl) {
                            // There are simply no results.
                            return resultsText;
                        } else {
                            const errorText = await el.evaluate(el => el.textContent);
                            await crawler.log("Discord returned error for search results: ", errorText);
                            await crawler.log("This likely signals rate limiting. Will wait for 5s.");
                            searchFinished = false;
                            await crawler.page.waitForTimeout(5000);
                            await this._pressCtrlF(crawler.page);
                            await crawler.page.keyboard.press('Enter');
                        }
                    }
                } else {
                    throw Error("Did not get search results after 10 seconds.");
                }
            }
        }

        const resultsText = await performAndWaitForSearchResults(
            crawler.page.keyboard.press('Enter')
        );

        await crawler.log("Search results: " + resultsText);

        if (resultsText == "No Results") {
            // No search results match our criteria -- we're done scraping this channel
            await crawler.page.click('[aria-label="Clear search"]');
            return;
        }

        const messageCount = parseInt(resultsText.split(" ")[0].replace(",", ""));
        console.log(`Estimate to download ${messageCount} messages: `, Math.round(messageCount / 50 * 0.75 / 60), "minutes");
        
        // Switch the order from oldest messages
        await performAndWaitForSearchResults(
            crawler.page.click(`div[aria-controls="oldest-tab"]`)
        );

        const firstResultSelector = `#search-results > ul > li:first-of-type`;
        const firstMessageId = await crawler.page.$eval(
            firstResultSelector,
            el => el.attributes['aria-labelledby'].value.split('-')[2]
        ) as string;

        await crawler.log(`ID of first message in search results: ${firstMessageId}`);

        if (this.after) {
            if (BigInt(firstMessageId) < BigInt(datetimeToDiscordSnowflake(this.after))) {
                throw Error("First message ID is less than the after date");
            }
        }

        // Reason we click the h2 is that there may be an embed image, link,
        // or server and we don't want to hit that
        await crawler.page.click(`${firstResultSelector} div[class^="contents"] h2`);
        
        // Wait for the message to show up
        await crawler.page.waitForSelector(`#chat-messages-${firstMessageId}`);

        // Close the search results
        await crawler.page.click('[aria-label="Clear search"]');

        return [firstMessageId, messageCount];
    }

    async _scrollChat(crawler: CrawlerInterface, messageCount: number) {
        // scroll down and stop until we either hit the bottom or a message
        // that's after the after date

        let scrollTimes = 0;

        const startTime = new Date().getTime();
        const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar1.start(messageCount, 0);

        let prevLastMessageId = null;
        while (true) {
            const messageSelector = `ol[data-list-id="chat-messages"] li[id^="chat-messages"]`;
            const messageIds = await crawler.page.$$eval(messageSelector, els => els.map(el => el.id.split('-')[2]));
            const lastMessageId = messageIds[messageIds.length - 1];

            if (prevLastMessageId != lastMessageId) {
                prevLastMessageId = lastMessageId;
                scrollTimes++;
                bar1.update(scrollTimes * 50);
            }

            if (this.before) {
                if (BigInt(lastMessageId) >= BigInt(datetimeToDiscordSnowflake(this.before))) {
                    bar1.stop();
                    await crawler.log(`We have reached the last message we are interested in (ID ${lastMessageId})`);
                    break;
                }
            }

            if (!await crawler.page.$(`div[class^="jumpToPresentBar"`)) {
                bar1.stop();
                await crawler.log(`We have reached the last message ("Jump to Present" bar is not present)`);
                break;
            }

            //await crawler.log(`Scrolling to last message (ID ${lastMessageId})...`)
            await crawler.page.$eval(`#chat-messages-${lastMessageId}`,
                el => el.scrollIntoView({block: 'end'})
            );
            await crawler.page.waitForTimeout(200);
        }
        const endTime = new Date().getTime();

        await crawler.log(`Channel ${this.channelId} finished (scrolled ${scrollTimes} times, took ${(endTime - startTime) / 1000 / 60} minutes)`);
    }

    async perform(crawler: CrawlerInterface) {
        await this._openChannel(crawler);

        const result = await this._searchAndClickFirstResult(crawler);

        if (!result) return;
        
        const [firstMessageId, messageCount] = result;

        await this._scrollChat(crawler, messageCount);

        //await crawler.page.waitForTimeout(15_000);
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

    async perform(crawler: CrawlerInterface) {
        await openServer(crawler.page, this.serverId);
        
        // Return a list of tasks for each channel
        const channels = await crawler.page.$$('#channels ul li a[role="link"]');

        await crawler.log(`Discovered ${channels.length} channels, creating tasks`);
        
        return await Promise.all(
            channels.map(async (el) => {
                const channelId = await el.evaluate(el => el.attributes['data-list-item-id'].value.split('_')[3]) as string;
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
