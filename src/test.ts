import * as fs from 'fs/promises';

import { Crawler } from './crawl';
import { DiscordProject, ProfileDiscordTask, ChannelDiscordTask } from './discord';
import { DummyCaptureTool } from './captureTools/captureTools';
import { Mitmdump } from './captureTools/mitmdump';

const TEST_DISCORD_EMAIL = "test_ahcae@protonmail.com";
const TEST_DISCORD_PASSWORD = "9jVjMMp11QY1sMiJh87hDShqQ";

jest.setTimeout(45_000);

test('restarts mitmdump twice', async () => {
    let mitmdump = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")) + "/mitmdump");
    await mitmdump.start();
    await mitmdump.close();

    let mitmdump2 = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")) + "/mitmdump");
    await mitmdump2.start();
    await mitmdump2.close();
});

test('initializes a crawler', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [],
        mode: 'none',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: DummyCaptureTool,
        headless: true,
    });
    expect(crawler).toBeTruthy();
});

test('runs a profile job against a replay', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [],
        mode: 'profile',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        serverSideReplayFile: './test_data/profile/mitmdump',
        captureTool: Mitmdump,
        headless: true,
    });

    await crawler.run()
    expect(crawler).toBeTruthy();

    let state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8'));
    expect(state.jobFinished).toBeTruthy();
});

test('runs a channel job against a replay', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [
            new ChannelDiscordTask("954365197735317514", "954365197735317517", "2010-01-01", null)
        ],
        mode: 'channel',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        serverSideReplayFile: './test_data/channel/mitmdump',
        captureTool: Mitmdump,
        headless: true,
    });

    await crawler.run()
    expect(crawler).toBeTruthy();

    let state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8'));
    expect(state.jobFinished).toBeTruthy();

    // TODO verify some messages
});