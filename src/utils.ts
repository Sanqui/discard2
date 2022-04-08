import puppeteer from 'puppeteer';

const numRetries = 15;

export async function getUrlsFromLinks(page: puppeteer.Page, selector: string): Promise<URL[]> {
    return (await page.$$eval(
        selector,
        elements => elements.map(el => el.getAttribute('href'))
    )).map(url => new URL(url, page.url()));
}

// Inspired by https://stackoverflow.com/a/56892074
export async function retry(promiseFactory, retryCount: number, name?: string) {
    try {
        return await promiseFactory();
    } catch (error) {
        if (retryCount <= 0) {
            throw error;
        }

        if (error instanceof puppeteer.errors.TimeoutError) {
            let error_string = "TimeoutError"
            if (name) {
                error_string = `${error_string} when ${name}`
            }
            console.log(`${error_string}, retrying ${retryCount - 1} more times`);
            return await retry(promiseFactory, retryCount - 1, name);
        } else {
            throw error;
        }
    }
}

export async function clickAndWaitForNavigation(page: puppeteer.Page, selector: string) {
    return await retry(
        () => Promise.all([
            page.click(selector),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000})
        ]),
        numRetries // retry count
    );
}

export async function retryGoto(page: puppeteer.Page, url: URL) {
    return await retry(
        () => page.goto(url.toString(), { waitUntil: 'networkidle2'}),
        numRetries
    );
}

export async function waitForAndClick(page: puppeteer.Page, selector: string, error_message: string) {
    try {
        await page.waitForSelector(selector, { timeout: 5000 })
    } catch (e) {
        throw new Error(error_message)
    }
    await page.click(selector);
}

//export async function reachElementWithTab(page: puppeteer.Page, el: puppeteer.ElementHandle) {
//    while(true) {
//        let focusedElement = await page.evaluateHandle(() => document.activeElement);
//        if (focusedElement === el) {
//            return;
//        }
//        await page.keyboard.press('Tab');
//        await page.waitForTimeout(200);
//    }
//}
