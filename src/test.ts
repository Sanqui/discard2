import * as fs from 'fs/promises';

import { Crawler } from './crawl';
import { DiscordProject, ProfileDiscordTask, ChannelDiscordTask } from './discord';
import { DummyCaptureTool } from './captureTools/captureTools';
import { Mitmdump, MitmdumpReplay } from './captureTools/mitmdump';
import { Tshark } from './captureTools/tshark';
import { Reader, OutputFormats, ReaderOutput } from './reader/reader';

const TEST_DISCORD_EMAIL = "test_ahcae@protonmail.com";
const TEST_DISCORD_PASSWORD = "9jVjMMp11QY1sMiJh87hDShqQ";

jest.setTimeout(60_000);

test('restarts mitmdump twice', async () => {
    let mitmdump = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")));
    await mitmdump.start();
    await mitmdump.close();

    let mitmdump2 = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")));
    await mitmdump2.start();
    await mitmdump2.close();
});

test('starts and closes tshark', async () => {
    let tshark = new Tshark((await fs.mkdtemp("/tmp/discard2-test-")));
    await tshark.start();
    await tshark.close();
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
    const mitmdump = new MitmdumpReplay('./test_data/profile/');
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [],
        mode: 'profile',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: Tshark,
        headless: true,
        proxyServerAddress: mitmdump.proxyServerAddress,
    });

    await mitmdump.start();
    await crawler.run()
    await mitmdump.close();

    let state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8'));
    expect(state.jobFinished).toBeTruthy();
});

test('runs a channel job against a replay', async () => {
    const mitmdump = new MitmdumpReplay('./test_data/channel/');
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [
            new ChannelDiscordTask("954365197735317514", "954365197735317517", "2010-01-01", null)
        ],
        mode: 'channel',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: Tshark,
        headless: true,
        proxyServerAddress: mitmdump.proxyServerAddress,
    });

    await mitmdump.start();
    await crawler.run()
    await mitmdump.close();

    console.log("Data path is", crawler.dataPath);
    // show list of files under crawler.dataPath
    let files = await fs.readdir(crawler.dataPath);
    console.log("Files are", files);

    let state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8'));
    expect(state.jobFinished).toBeTruthy();

    let testMessageRead = false;

    let reader = new Reader(crawler.dataPath, false, OutputFormats.JSONL,
        (data: ReaderOutput) => {
            //console.log(data);
            if (data.type == "http"
                && data.request.method == "GET"
                && data.request.url.includes("/messages")
                && data.response.status == 200
                && JSON.stringify(data.response.data).includes("testing 123"))
            {
                testMessageRead = true;
            }
        });
    await reader.read();

    expect(testMessageRead).toBeTruthy();
});

// TODO add a test to read a real pcapng capture,
// not just those re-captured from the mitmdump replay
