import { Crawler } from './crawl';
import { DiscordProject } from './discord';
import * as fs from 'fs/promises';

const TEST_DISCORD_EMAIL = "test_ahcae@protonmail.com";
const TEST_DISCORD_PASSWORD = "9jVjMMp11QY1sMiJh87hDShqQ";

jest.setTimeout(45_000);

test('initializes a crawler', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        mode: 'profile',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        headless: true,
    });
    expect(crawler).toBeTruthy();
});

test('runs a profile job against a replay', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        mode: 'profile',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        serverSideReplayFile: './test_data/profile/mitmdump',
        headless: true,
    });

    await crawler.run()
    expect(crawler).toBeTruthy();

    let state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8'));
    expect(state.jobFinished).toBeTruthy();
});