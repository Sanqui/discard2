import * as puppeteer_types from 'puppeteer';

import {CrawlerInterface} from '../../crawl';
import { waitForAndClick, scrollToBottom, scrollToTop } from '../../utils';
import { ChannelDiscordTask } from './channel';
import {DiscordTask} from './utils'

export async function openServer(page: puppeteer_types.Page, serverId: string) {
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
        // Discord loads channels dynamically, so we have to scroll through the list to see them all

        await scrollToTop(crawler.page, `#channels`);

        const channelIds: string[] = [];

        await scrollToBottom(crawler.page, `#channels`,
            async () => {
                const channelEls = await crawler.page.$$('#channels ul li a[role="link"]');
                for (const el of channelEls) {
                    const channelId = await el.evaluate(el => el.attributes['data-list-item-id'].value.split('_')[3]) as string;
                    if (channelIds.indexOf(channelId) == -1) {
                        channelIds.push(channelId);
                    }
                }
            }
        );

        await crawler.log(`Discovered ${channelIds.length} channels, creating tasks`);
        
        return channelIds.map(
            el => new ChannelDiscordTask(this.serverId, el, this.after, this.before)
        );
    }
}