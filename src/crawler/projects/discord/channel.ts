import dateFormat from "dateformat";

import * as puppeteer_types from 'puppeteer';
import cliProgress from 'cli-progress';

import {CrawlerInterface} from '../../crawl';
import { retry, scrollToBottom, scrollToTop, waitForAndClick } from '../../utils';
import { openServer } from './server';
import {datetimeToDiscordSnowflake, DiscordTask} from './utils'

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
            await scrollToTop(crawler.page, `#channels`);

            await scrollToBottom(crawler.page, `#channels`,
                async () => {
                    return !!await crawler.page.$(channelLinkSelector);
                }
            );
        }

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

        if (await crawler.page.$(`div[class^="chat"] div[class*="gatedContent"]`)) {
            await crawler.log('Hit "Age-Restricted Channel" message, continuing...');
            await crawler.page.click(`div[class^="chat"] div[class*="gatedContent"] button:nth-of-type(2)`);
            await crawler.page.waitForTimeout(100);

        }

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
        await crawler.log(`Estimate to download ${messageCount} messages: `, Math.round(messageCount / 50 * 0.75 / 60), "minutes");
        
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
        const h2Selector = `${firstResultSelector} div[class^="contents"] h2`
        if (await crawler.page.$(h2Selector)) {
            await crawler.page.click(`${firstResultSelector} div[class^="contents"] h2`);
        } else {
            // This may be a join or other type of system message, click on the icon to open the message
            await crawler.page.click(`${firstResultSelector} div[class^="contents"] div[class^="iconContainer"]`);
        }
        
        // Wait for the message to show up
        await crawler.page.waitForSelector(`#chat-messages-${firstMessageId}`);

        // Close the search results
        await crawler.page.click('[aria-label="Clear search"]');

        // "You're viewing older messages" doesn't always show up immediately
        await crawler.page.waitForTimeout(100);

        return [firstMessageId, messageCount];
    }

    async _scrollChat(crawler: CrawlerInterface, messageCount: number) {
        // scroll down and stop until we either hit the bottom or a message
        // that's after the after date

        const chatSelector = `div[class^="chat"]`;

        let scrollTimes = 0;

        const startTime = new Date().getTime();
        const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar1.start(messageCount, 0);

        let prevLastMessageId = null;
        let jigglePhase = false;
        while (true) {
            const messageSelector = `${chatSelector} ol[data-list-id="chat-messages"] li[id^="chat-messages"]`;
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
            let scrollFunc = (el: Element) => el.scrollIntoView(true);
            if (prevLastMessageId == lastMessageId) {
                // If we're stuck on the same message, jiggle the scroll
                if (jigglePhase) {
                    scrollFunc = (el: Element) => el.scrollIntoView(false);
                }
                jigglePhase = !jigglePhase;
            }
            await crawler.page.$eval(`#chat-messages-${lastMessageId}`,
                scrollFunc
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


export class DMDiscordTask extends ChannelDiscordTask {
    type = "DMDiscordTask";
    channelId: string;
    after?: Date;
    before?: Date;

    constructor(
        channelId: string,
        after?: Date | string,
        before?: Date | string,
    ) {
        // XXX a minimal "after" date is provided because Discord doesn't
        // allow searching in DMs without some filter
        // This is pending a refactor to support downloading chat
        // without searching (though the message count is still useful)
        super(null, channelId, after || new Date("2010-01-01"), before);
    }

    async _openChannel(crawler: CrawlerInterface) {
        const privateChannelsSelector = `nav[class^="privateChannels"]`;
        
        if (await crawler.page.$(privateChannelsSelector)) {
            // DM list is already open
        } else {
            await waitForAndClick(crawler.page, 
                `[data-list-item-id=guildsnav___home]`,
                `Home button not found`
            );
    
            await crawler.page.waitForSelector(privateChannelsSelector);
        }

        const dmLinkSelector = `[data-list-id^="private-channels"] ul li a[href="/channels/@me/${this.channelId}"]`;

        if (!await crawler.page.$(dmLinkSelector)) {
            // TODO refactor these into a findInScroller function
            await scrollToTop(crawler.page, `[data-list-id^="private-channels"]`);

            await scrollToBottom(crawler.page, `[data-list-id^="private-channels"]`,
                async () => {
                    return !!await crawler.page.$(dmLinkSelector);
                }
            );
        }

        if (!await crawler.page.$(dmLinkSelector)) {
            throw Error(`DM ID ${this.channelId} not found`);
        }

        await crawler.page.$eval(dmLinkSelector,
            el => el.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"})
        );

        // Tragically, Discord offers no solid indication a DM with a given ID is actually open

        await retry(async () => {
            await crawler.page.click(dmLinkSelector, { delay: 50 });
            await crawler.page.waitForSelector(
                `[data-list-id^="private-channels"] ul li div[class*="selected"] a[href="/channels/@me/${this.channelId}"]`,
                { timeout: 200 }
            );
        }, 10, "opening channel");

        await crawler.log(`DM ${this.channelId} opened`)
    }
}


export class ThreadDiscordTask extends ChannelDiscordTask {
    type = "ThreadDiscordTask";
    serverId: string;
    channelId: string;
    threadId: string;

    constructor(
        serverId: string,
        channelId: string,
        threadId: string,
    ) {
        super(serverId, channelId, null, null);
        this.threadId = threadId;
    }

    // Finds a given thread in a channel if provided,
    // else finds all threads
    async findThread(crawler: CrawlerInterface, threadId?: string) {
        const threads: unknown[] = [];
        let stopSearching = false;

        const urlMatches = (url: string) =>
            url.match(`^https://discord.com/api/v9/channels/${this.channelId}/threads/search`)
        ;

        let threadsResponseHandler: (response: puppeteer_types.HTTPResponse) => Promise<void>;

        // Promise which resolves once all threads have been fetched
        const allThreadsPromise = new Promise<void>(resolve => {
            // Response handler for thread information
            threadsResponseHandler = async (response) => {
                if (urlMatches(response.url()) && response.status() === 200) {
                    const json = await response.json();
                    threads.push(...json.threads);
                    if (
                        (threadId && json.threads.find(t => t.id === threadId))
                        || !json.has_more
                    ) {
                        stopSearching = true;
                        crawler.page.off("response", threadsResponseHandler);
                        resolve();
                    }
                }
            }
        });

        crawler.page.on("response", threadsResponseHandler);

        // Open threads dialog
        await crawler.page.click(`[role="button"][aria-label="Threads"]`);
        // Wait for dialog to open and first answer to load
        await Promise.all([
            crawler.page.waitForSelector(`div[role="dialog"]`),
            crawler.page.waitForResponse(response =>
                urlMatches(response.url()) && response.status() === 200
            )
        ]);
        // Scroll list of threads, stopping early if we already found the thread
        // or if we've reached the end of the list
        await scrollToBottom(
            crawler.page, `div[role="dialog"] div[class^="list"]`,
            async () => stopSearching
        );
        // Wait for all thread request responses to come in
        await Promise.resolve(allThreadsPromise);

        if (threadId) {
            // TODO click on this thread
        } else {
            await crawler.log(`Discovered ${threads.length} threads`);
            return threads;
        }
    }

    async perform(crawler: CrawlerInterface) {
        await this._openChannel(crawler);

        await this.findThread(crawler, this.threadId);
    }
}