import * as fs from 'fs/promises';

import { Crawler, CrawlerState } from './crawler/crawl';
import { DiscordProject, ProfileDiscordTask, ChannelDiscordTask, ServerDiscordTask, LoginDiscordTask } from './crawler/projects/discord';
import { DummyCaptureTool } from './captureTools';
import { Mitmdump, MitmdumpReplay } from './captureTools/mitmdump';
import { Tshark } from './captureTools/tshark';
import { Reader, OutputFormats } from './reader/reader';
import { ReaderOutput } from './reader/output';

const TEST_DISCORD_EMAIL = "test_ahcae@protonmail.com";
const TEST_DISCORD_PASSWORD = "9jVjMMp11QY1sMiJh87hDShqQ";

jest.setTimeout(60_000);

test('restarts mitmdump twice', async () => {
    const mitmdump = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")));
    await mitmdump.start();
    mitmdump.close();

    const mitmdump2 = new Mitmdump((await fs.mkdtemp("/tmp/discard2-test-")));
    await mitmdump2.start();
    mitmdump2.close();
});

test('starts and closes tshark', async () => {
    const tshark = new Tshark((await fs.mkdtemp("/tmp/discard2-test-")));
    await tshark.start();
    tshark.close();
});

test('initializes a crawler', async () => {
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [],
        mode: 'none',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: DummyCaptureTool,
        headless: true,
        blockImages: true,
    });
    expect(crawler).toBeTruthy();
});

test('runs a profile job against a replay', async () => {
    const dataPath = "./test_data/profile/";
    // read the account username and pasword from the state file
    const testState = JSON.parse(await fs.readFile(`${dataPath}/state.json`, 'utf8')) as CrawlerState;
    const initialTask = testState.settings.project.initialTasks[0] as LoginDiscordTask;

    const mitmdump = new MitmdumpReplay(dataPath);
    const crawler = new Crawler({
        project: new DiscordProject(initialTask.discordEmail, initialTask.discordPassword),
        tasks: [],
        mode: 'profile',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: Tshark,
        headless: false,
        proxyServerAddress: mitmdump.proxyServerAddress,
        blockImages: true,
    });

    await mitmdump.start();
    await crawler.run()
    mitmdump.close();

    const state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8')) as CrawlerState;
    expect(state.job.completed).toBeTruthy();
});

async function checkForMessages(dataPath: string, expected: Set<string>) {
    const seen = new Set<string>();
    const reader = new Reader(dataPath, false, OutputFormats.RAW_JSONL,
        (data: ReaderOutput) => {
            //console.log(data);
            if (data.type == "http"
                && data.request.method == "GET"
                && data.request.path.includes("/messages")
                && data.response.status_code == 200
            ) {
                for (const message of expected) {
                    if (JSON.stringify(data.response.data).includes(message)) {
                        seen.add(message);
                    }
                }
            }
        });
    await reader.read();
    expect(seen).toEqual(expected);
}

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
        blockImages: true,
    });

    await mitmdump.start();
    await crawler.run()
    mitmdump.close();

    const state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8')) as CrawlerState;
    expect(state.job.completed).toBeTruthy();

    await checkForMessages(crawler.dataPath, new Set(["testing 123", "300"]));
});

test('runs a server job against a replay', async () => {
    const mitmdump = new MitmdumpReplay('./test_data/server/');
    const crawler = new Crawler({
        project: new DiscordProject(TEST_DISCORD_EMAIL, TEST_DISCORD_PASSWORD),
        tasks: [
            new ServerDiscordTask("954365197735317514", null, null)
        ],
        mode: 'server',
        outputDir: await fs.mkdtemp("/tmp/discard2-test-"),
        captureTool: Tshark,
        headless: true,
        proxyServerAddress: mitmdump.proxyServerAddress,
        blockImages: true,
    });

    await mitmdump.start();
    await crawler.run()
    mitmdump.close();

    const state = JSON.parse(await fs.readFile(`${crawler.dataPath}/state.json`, 'utf8')) as CrawlerState;
    expect(state.job.completed).toBeTruthy();

    console.log(`dataPath: ${crawler.dataPath}`);

    await checkForMessages(crawler.dataPath, new Set(
        ["testing 123", "300", "chat msg", "test message left in channel chat2",
        "message in last channel"]
    ));
});

test('parse a mitmdump server capture', async () => {
    await checkForMessages('./test_data/server/', new Set(
        ["testing 123", "300", "chat msg", "test message left in channel chat2",
        "message in last channel"]
    ));
});

test('test every reader output format', async () => {
    for (const outputFormat of Object.values(OutputFormats)) {
        const reader = new Reader('./test_data/server/', false, outputFormat);
        await reader.read();
    }
});
