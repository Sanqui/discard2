import dateFormat from "dateformat";

import * as puppeteer_types from 'puppeteer';
import cliProgress from 'cli-progress';

import { CrawlerInterface } from '../../crawl';
import { retry, scrollToBottom, scrollToTop, waitForAndClick } from '../../utils';
import { getCurrentServerName, openServer } from './server';
import {datetimeToDiscordSnowflake, DiscordID, DiscordTask} from './utils'

async function openChannel(crawler: CrawlerInterface, serverId: DiscordID, channelId: DiscordID) {
    await openServer(crawler.page, serverId);

    const channelLinkSelector = `#channels ul li [data-list-item-id=channels___${channelId}]`;

    if (!await crawler.page.$(channelLinkSelector)) {
        await scrollToTop(crawler.page, `#channels`);

        await scrollToBottom(crawler.page, `#channels`,
            async () => {
                return !!await crawler.page.$(channelLinkSelector);
            }
        );
    }

    if (!await crawler.page.$(channelLinkSelector)) {
        throw Error(`Channel ID ${channelId} not found`);
    }

    // We need to scroll because of the "New unreads" indicator

    await crawler.page.$eval(channelLinkSelector,
        el => el.scrollIntoView({behavior: "smooth", block: "center", inline: "nearest"})
    );

    await retry(async () => {
        await crawler.page.click(channelLinkSelector, { delay: 50 });
        await crawler.page.waitForSelector(`[data-list-id="members-${channelId}"]`, { timeout: 200 });
    }, 10, "opening channel");

    if (await crawler.page.$(`div[class^="chat"] div[class*="gatedContent"]`)) {
        await crawler.log('Hit "Age-Restricted Channel" message, continuing...');
        await crawler.page.click(`div[class^="chat"] div[class*="gatedContent"] button:nth-of-type(2)`);
        await crawler.page.waitForTimeout(100);

    }

    await crawler.log(`Channel ${channelId} opened`)
}

export class ChannelDiscordTask extends DiscordTask {
    type = "ChannelDiscordTask";
    after?: Date;
    before?: Date;
    progress: {
        lastMessageId?: DiscordID
    };

    result: {
        serverName: string,
        channelName: string,
        threadName: string,
        dmUserName: string,
        firstMessageId: DiscordID,
        lastMessageId: DiscordID,
    }

    constructor(
        public serverId: DiscordID,
        public channelId: DiscordID,
        after?: Date | string,
        before?: Date | string,
    ) {
        super();

        this.after = typeof after == "string" ? new Date(after) : after;
        this.before = typeof before == "string" ? new Date(before) : before;

        this.progress = {}
    }

    async _pressCtrlF(page: puppeteer_types.Page) {
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyF');
        await page.keyboard.up('Control');
    }

    async _searchAndClickFirstResult(crawler: CrawlerInterface): Promise<[DiscordID, number] | void> {
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

                const msWaitFor = 30_000;
                const msInterval = 100;
                for (let i = 0; i < msWaitFor/msInterval; i++) {
                    resultsText = await crawler.page.$eval(resultsSelector, el => el.textContent);
                    if (!["Searching???", "Indexing???"].includes(resultsText.trim())) {
                        searchFinished = true;
                        break;
                    }

                    await crawler.page.waitForTimeout(msInterval);
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
                    throw Error(`Did not get search results after ${msWaitFor / 1_000} seconds.`);
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

        const messageCount = parseInt(resultsText.split(" ")[0].replace(/,/g, ""));
        await crawler.log(`Estimate to download ${messageCount} messages: `, Math.round(messageCount / 50 * 0.75 / 60), "minutes");
        
        // Switch the order from oldest messages
        await performAndWaitForSearchResults(
            crawler.page.click(`div[aria-controls="oldest-tab"]`)
        );

        const firstResultSelector = `#search-results > ul > li:first-of-type`;
        const firstMessageId = await crawler.page.$eval(
            firstResultSelector,
            el => el.attributes['aria-labelledby'].value.split('-')[2]
        ) as DiscordID;

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

    async _scrollChat(crawler: CrawlerInterface, messageCount: number): Promise<DiscordID> {
        // scroll down and stop until we either hit the bottom or a message
        // that's after the after date

        const chatSelector = `div[class^="chat"]`;

        let scrollTimes = 0;

        const startTime = new Date().getTime();
        const bar1 = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        bar1.start(messageCount, 0);

        let lastMessageId: DiscordID = null;
        let prevLastMessageId = null;
        let jigglePhase = false;
        while (true) {
            this.progress.lastMessageId = lastMessageId;

            const messageSelector = `${chatSelector} ol[data-list-id="chat-messages"] li[id^="chat-messages"]`;
            const messageIds = await crawler.page.$$eval(messageSelector, els => els.map(el => el.id.split('-')[2]));
            lastMessageId = messageIds[messageIds.length - 1];

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

            if (!await crawler.page.$(`div[class^="jumpToPresentBar"]`)) {
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

        this.progress.lastMessageId = lastMessageId;

        return lastMessageId;
    }

    async perform(crawler: CrawlerInterface) {
        await openChannel(crawler, this.serverId, this.channelId);
        
        this.result.serverName = await getCurrentServerName(crawler.page);

        this.result.channelName = await crawler.page.$eval(
            `[class^="chat"] section[class^="title"] h3`,
            el => el.innerHTML.trim()
        );

        const result = await this._searchAndClickFirstResult(crawler);

        if (!result) return;
        
        const [firstMessageId, messageCount] = result;

        this.result.firstMessageId = firstMessageId;

        this.result.lastMessageId = await this._scrollChat(crawler, messageCount);

        //await crawler.page.waitForTimeout(15_000);
    }
}


export class DMDiscordTask extends ChannelDiscordTask {
    type = "DMDiscordTask";
    after?: Date;
    before?: Date;

    constructor(
        public channelId: DiscordID,
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

        this.result.dmUserName = await crawler.page.$eval(
            `[class^="chat"] section[class^="title"] h3`,
            el => el.innerHTML.trim()
        );
    }
}

// XXX this should really be on the Project, regardless,
// since Discord doesn't re-request the thread list when
// we open it, we have to keep it locally
const threadCache: unknown[] = [];
const readThreadsFromChannel: Map<DiscordID, boolean> = new Map();

// Finds a given thread in a channel if provided,
// else finds all threads
async function findThread(crawler: CrawlerInterface, channelId: DiscordID, threadId?: DiscordID) {
    await crawler.log(`Finding thread ${threadId} in channel ${channelId}...`);
    const threads: unknown[] = [];
    let stopSearching = false;

    const urlMatches = (url: string) =>
        url.match(`^https://discord.com/api/v9/channels/${channelId}/threads/search`)
    ;

    let threadsResponseHandler: (response: puppeteer_types.HTTPResponse) => Promise<void>;

    // Promise which resolves once all threads have been fetched
    const allThreadsPromise = new Promise<void>(resolve => {
        // Response handler for thread information
        threadsResponseHandler = async (response) => {
            if (urlMatches(response.url()) && response.status() === 200) {
                const json = await response.json() as unknown;
                console.log(`Received response with thread data (has more: ${json['has_more']})`);
                threads.push(...json['threads']);
                threadCache.push(...json['threads']);
                if (
                    (threadId && json['threads'].find(t => t['id'] === threadId))
                    || !json['has_more']
                ) {
                    stopSearching = true;
                    crawler.page.off("response", threadsResponseHandler);
                    resolve();
                }
            }
        }
    });

    crawler.page.on("response", threadsResponseHandler);

    // If we're looking for a thread, and it's already in our cache,
    // don't require things to load
    if (!(threadId && threadCache.find(t => t['id'] === threadId))) {
        // Wait for dialog to open and first answer to load
        //await crawler.log(`Waiting for threads dialog to open and first answer to load`);
        await retry(async () => {
            await crawler.page.keyboard.press('Escape'),
            await crawler.page.waitForTimeout(200),
            await crawler.page.click(`[role="button"][aria-label="Threads"]`);
            await Promise.all([
                crawler.page.waitForSelector(`div[role="dialog"]`),
                crawler.page.waitForResponse(
                    response => urlMatches(response.url()) && response.status() === 200,
                    { timeout: 10_000 }
                )
            ]);
        }, 5, "opening threads dialog");

        // Scroll list of threads, stopping early if we already found the thread
        // or if we've reached the end of the list
        await crawler.log(`Scrolling list of threads`);
        await scrollToBottom(
            crawler.page, `div[role="dialog"] div[class^="list"]`,
            async () => stopSearching,
            true
        );
        // Wait for all thread request responses to come in
        await crawler.log(`Waiting for all thread request responses to come in`);
        await Promise.resolve(allThreadsPromise);
    } else {
        // Open threads dialog
        await crawler.page.click(`[role="button"][aria-label="Threads"]`);
        await crawler.page.waitForSelector(`div[role="dialog"]`);
        crawler.page.off("response", threadsResponseHandler);
    }

    if (threadId) {
        let thread = threads.find(t => t['id'] === threadId);
        if (!thread) {
            thread = threadCache.find(t => t['id'] === threadId);
            if (!thread) {
                throw Error(`Thread ${threadId} not found`);
            }
        }
        // XXX this finds the right thread button by its name.
        // It wll work in the majority of cases but is error prone.
        // Yet, Discord does not expose the thread ID in its UI.
        let found = false;
        await crawler.page.$eval(`div[role="dialog"] div[class^="list"]`,
            el => el.scrollBy(0, -600)
        );
        await scrollToBottom(
            crawler.page, `div[role="dialog"] div[class^="list"]`,
            async () => {
                const buttons = await crawler.page.$$('div[role="dialog"] div[class^="list"] div[role="button"]');
                for (const button of buttons) {
                    if (await button.$eval('h3 span', el => el.innerHTML.trim()) === thread['name']) {
                        await retry(async () => {
                            await crawler.page.waitForTimeout(100);
                            await button.click({ delay: 200 });
                            await crawler.page.waitForSelector(
                                `li[class*="selected"] [data-list-item-id="channels___${threadId}"]`,
                                { timeout: 200 }
                            );
                        }, 5, "clicking thread button");
                        found = true;
                        return true;
                    }
                }
            }, false, 100
        );
        if (!found) {
            throw Error(`Button for ${threadId} not found, but we know it's there...`);
        }
        await crawler.log(`Opened thread ${threadId}`);
    } else {
        await crawler.log(`Discovered ${threads.length} threads`);
        readThreadsFromChannel[channelId] = true;
        await crawler.page.keyboard.press('Escape');
        await crawler.page.waitForTimeout(1000);
        return threads;
    }
}


export class ThreadDiscordTask extends ChannelDiscordTask {
    type = "ThreadDiscordTask";

    constructor(
        public serverId: DiscordID,
        public channelId: DiscordID,
        public threadId: DiscordID,
    ) {
        super(serverId, channelId, null, null);
    }

    async _scrollChat(crawler: CrawlerInterface): Promise<DiscordID> {
        let lastMessageId: DiscordID = null;

        const chatSelector = `div[class^="chat"] div[class^="scroller"]`;
        
        await crawler.log(`Crawling thread ${this.threadId} (unable to show progress)...`);
        await crawler.page.$eval(chatSelector,
            el => el.scrollBy(0, 300)
        );
        await crawler.page.waitForTimeout(300);
        if (await crawler.page.$(`div[class^="jumpToPresentBar"]`)) {
            await crawler.log(`Clicking Jump to Present...`);
            // We see the "Jump to Present" button.
            // Smash it, because we only know how to scroll up in a thread.
            await retry(async () => {
                // It can literally disappear in the meantime
                if (await crawler.page.$(`div[class^="jumpToPresentBar"]`)) {
                    await crawler.page.click(`div[class^="jumpToPresentBar"]`, { delay: 200 });
                }
                await crawler.page.waitForSelector(
                    `div[class^="jumpToPresentBar"]`,
                    { hidden: true, timeout: 500 }
                );
            }, 5, "clicking Jump to Present");
        }

        // Scroll up until we reach the chat header, signifying the beginning
        // of the thread
        while (!await crawler.page.$(`#chat-messages-${this.threadId}`)) {
            await crawler.page.$eval(chatSelector,
                el => el.scrollBy(0, -800)
            );
            await crawler.page.waitForTimeout(300);
        }

        const messageSelector = `${chatSelector} ol[data-list-id="chat-messages"] li[id^="chat-messages"]`;
        const messageIds = await crawler.page.$$eval(messageSelector, els => els.map(el => el.id.split('-')[2]));
        lastMessageId = messageIds[messageIds.length - 1];

        await crawler.log(`Finished thread ${this.threadId}`);

        return lastMessageId;
    }

    async perform(crawler: CrawlerInterface) {
        await openChannel(crawler, this.serverId, this.channelId);

        this.result.channelName = await crawler.page.$eval(
            `[class^="chat"] section[class^="title"] h3:first-child`,
            el => el.innerHTML.trim()
        );

        this.result.threadName = await crawler.page.$eval(
            `[class^="chat"] section[class^="title"] h3:last-child`,
            el => el.innerHTML.trim()
        );

        if (!readThreadsFromChannel[this.channelId]) {
            // build thread cache
            await crawler.log("Building thread cache for channel " + this.channelId);
            await findThread(crawler, this.channelId);
        }

        try {
            await findThread(crawler, this.channelId, this.threadId);
        } catch (e) {
            // This currently only happens when multiple threads
            // have the same name.  It should be made fatal though, or at least
            // put the task into failed tasks.
            await crawler.log(`Warning: Failed to find thread due to ${e}, skipping...`);
            await crawler.page.keyboard.press('Escape');
            await crawler.page.waitForTimeout(1000);
            return;
        }

        this.result.lastMessageId = await this._scrollChat(crawler);
    }
}


export class ChannelThreadsDiscordTask extends DiscordTask {
    type = "ChannelThreadsDiscordTask";

    constructor(
        public serverId: DiscordID,
        public channelId: DiscordID,
    ) {
        super();
    }


    async perform(crawler: CrawlerInterface) {
        await openChannel(crawler, this.serverId, this.channelId);

        const threads = await findThread(crawler, this.channelId);

        return threads.map(
            thread => new ThreadDiscordTask(this.serverId, this.channelId, thread['id'] as DiscordID)
        );
    }
}