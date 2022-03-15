import puppeteer from 'puppeteer';

const numRetries = 15;

export async function getUrlsFromLinks(page: puppeteer.Page, selector: string): Promise<URL[]> {
    return (await page.$$eval(
        selector,
        elements => elements.map(el => el.getAttribute('href'))
    )).map(url => new URL(url, page.url()));
}

// Inspired by https://stackoverflow.com/a/56892074
export async function retry(promiseFactory, retryCount: number) {
    try {
        return await promiseFactory();
    } catch (error) {
        if (retryCount <= 0) {
            throw error;
        }

        if (error instanceof puppeteer.errors.TimeoutError) {
            console.log(`TimeoutError, retrying ${retryCount - 1} more times`);
            return await retry(promiseFactory, retryCount - 1);
        } else {
            throw error;
        }
    }
}

export async function clickAndWaitForNavigation(page: puppeteer.Page, selector: string) {
    return await retry(
        () => Promise.all([
            page.click(selector),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000})
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
