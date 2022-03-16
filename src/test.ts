import { Crawler } from './crawl';
import { DiscordProject } from './discord';

test('initializes a crawler', () => {
    const crawler = new Crawler(
        new DiscordProject(),
        'profile',
        'test'
    );
    expect(crawler).toBeTruthy();
});