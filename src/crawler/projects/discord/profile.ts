import * as puppeteer_types from 'puppeteer';

import {CrawlerInterface} from '../../crawl';
import { retry } from '../../utils';
import {DiscordTask} from './utils'


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
                await page.waitForSelector("#my-account-tab", { timeout: 1000 })
            },
            15,
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