import {retryGoto} from '../../utils';
import {CrawlerInterface} from '../../crawl';
import {DiscordTask} from './utils'


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

        const fillInLoginForm = async () => {
            await crawler.log("Filling in login form")
            await crawler.page.type('input[name="email"]', this.discordEmail);
            await crawler.page.type('input[name="password"]', this.discordPassword);


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