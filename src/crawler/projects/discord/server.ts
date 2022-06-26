import * as puppeteer_types from 'puppeteer';

import {CrawlerInterface} from '../../crawl';
import { waitForAndClick, scrollToBottom, scrollToTop, retry } from '../../utils';
import { ChannelDiscordTask, ChannelThreadsDiscordTask } from './channel';
import {DiscordID, DiscordTask} from './utils'

export async function openServer(page: puppeteer_types.Page, serverId: DiscordID) {
    const channelLinkSelector = `#channels ul li a[href^="/channels/${serverId}"]`;
    
    if (await page.$(channelLinkSelector)) {
        // This server is already open
    } else {
        await retry(async () => {
            await waitForAndClick(page, 
                `[data-list-item-id=guildsnav___${serverId}]`,
                `Server ID ${serverId} not found`
            );

            // Wait for a single channel link with this server ID to appear
            // TODO: This may fail on servers without any available channel.

            await page.waitForSelector(channelLinkSelector, {timeout: 3});
        }, 5, "opening server");
    }

    // Make sure all categories are expanded  

    for await(const el of await page.$$('#channels ul li [class*="collapsed-"]')) {
        await el.click();
        // TODO await properly for the category to be expanded
        await page.waitForTimeout(200);
    }
}

export async function getCurrentServerName(page: puppeteer_types.Page) {
    return page.$eval(
        `[class^="base"] [class^="sidebar"] [class^="header"] [class^="name"]`,
        el => el.innerHTML.trim()
    );
}

export class ServerDiscordTask extends DiscordTask {
    type = "ServerDiscordTask";
    after?: Date;
    before?: Date;

    result: {
        serverName: string;
    }

    constructor(
        public serverId: DiscordID,
        after?: Date | string,
        before?: Date | string,
        public threadsOnly?: boolean,
    ) {
        super();

        this.after = typeof after == "string" ? new Date(after) : after;
        this.before = typeof before == "string" ? new Date(before) : before;
        this.threadsOnly = threadsOnly;
    }

    async perform(crawler: CrawlerInterface) {
        await openServer(crawler.page, this.serverId);
        
        this.result.serverName = await getCurrentServerName(crawler.page);

        // Return a list of tasks for each channel
        // Discord loads channels dynamically, so we have to scroll through the list to see them all

        await scrollToTop(crawler.page, `#channels`);

        const channelIds: string[] = [];

        await scrollToBottom(crawler.page, `#channels`,
            async () => {
                const channelEls = await crawler.page.$$('#channels ul li a[role="link"]');
                for (const el of channelEls) {
                    const channelId = await el.evaluate(el => el.attributes['data-list-item-id'].value.split('_')[3]) as DiscordID;
                    if (channelIds.indexOf(channelId) == -1) {
                        channelIds.push(channelId);
                    }
                }
            }
        );

        await crawler.log(`Discovered ${channelIds.length} channels, creating tasks`);
        
        if (!this.threadsOnly) {
            return channelIds.map(
                el => new ChannelDiscordTask(this.serverId, el, this.after, this.before)
            );
        } else {
            return channelIds.map(
                el => new ChannelThreadsDiscordTask(this.serverId, el)
            );
        }
    }
}




export class ServersDiscordTask extends DiscordTask {
    type = "ServersDiscordTask";
    after?: Date;
    before?: Date;

    constructor(
        after?: Date | string,
        before?: Date | string,
    ) {
        super();

        this.after = typeof after == "string" ? new Date(after) : after;
        this.before = typeof before == "string" ? new Date(before) : before;
    }

    async perform(crawler: CrawlerInterface) {
        const serverListSelector = "ul[data-list-id='guildsnav'] div[class^='scroller']";
        await crawler.page.waitForSelector(serverListSelector);

        const serverIds: string[] = [];
        await scrollToBottom(crawler.page, serverListSelector,
            async () => {
                const serverEls = await crawler.page.$$(`${serverListSelector} div[aria-label="Servers"] div[data-list-item-id^="guildsnav___"]`);
                for (const el of serverEls) {
                    const serverId = await el.evaluate(el => el.attributes['data-list-item-id'].value.split('_')[3]) as DiscordID;
                    if (serverIds.indexOf(serverId) == -1) {
                        serverIds.push(serverId);
                    }
                }
            }
        );

        await crawler.log(`Discovered ${serverIds.length} channels, creating tasks`);
        
        return serverIds.map(
            el => new ServerDiscordTask(el, this.after, this.before)
        );
    }
}