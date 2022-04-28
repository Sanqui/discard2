import dotenv from 'dotenv';
import { Command, Option } from 'commander';
import { spawn } from 'child_process';

import { Crawler, Task } from './crawler/crawl';
import { DiscordProject, DMDiscordTask, ChannelDiscordTask, ThreadDiscordTask, ServerDiscordTask } from './crawler/projects/discord';
import { Reader } from './reader/reader';
import { DummyCaptureTool } from './captureTools';
import { Mitmdump } from './captureTools/mitmdump';
import { Tshark } from './captureTools/tshark';

const captureTools = {
    "none": DummyCaptureTool,
    "mitmdump": Mitmdump,
    "tshark": Tshark
}

dotenv.config();

const program = new Command();

program
    .name('discard2')
    .description('Discord archival tool')
;

function addCommonOptions(command: Command) {
    return command
        .addOption(
            new Option('-e, --email <email>', 'Discord account email').env('DISCORD_EMAIL').makeOptionMandatory()
        )
        .addOption(
            new Option('-p, --password <password>', 'Discord account password').env('DISCORD_PASSWORD').makeOptionMandatory()
        )
        .addOption(
            new Option('-b, --browser-data-dir <path>', 'Browser data directory').env('BROWSER_DATA_DIR')
        )
        .addOption(
            new Option('-c, --capture-tool <tool>', 'Capture tool')
                .choices(['none', 'mitmdump', 'tshark'])
                .env('CAPTURE_TOOL').makeOptionMandatory()
        )
        .option('--headless', 'Run in headless mode')
        .option('--block-images', 'Do not load images to conserve bandwidth')
    ;
}

async function crawler(opts, mode: string, tasks: Task[], resume?: string) {
    const crawler = new Crawler({
        project: new DiscordProject(opts.email, opts.password),
        tasks: tasks,
        mode: mode,
        browserDataDir: opts.browserDataDir,
        captureTool: captureTools[opts.captureTool],
        headless: opts.headless,
        blockImages: opts.blockImages,
        resume: resume
    });

    await crawler.run();
}


addCommonOptions(program.command('profile'))
    .description('Log in and fetch profile information')
    .action( async (opts) => {
        await crawler(opts, 'profile', [])
    })


    addCommonOptions(program.command('dm'))
    .description('Download a single DM')
    .argument('<dm-id>', 'Channel ID')
    .option('--after <date>', 'Date after which to retrieve history')
    .option('--before <date>', 'Date before which to retrieve history')
    .action( async (channelId, opts) => {
        await crawler(opts, 'dm',
        [
            new DMDiscordTask(channelId, opts.after, opts.before)
        ])
    });


addCommonOptions(program.command('channel'))
    .description('Download a single channel')
    .argument('<server-id>', 'Server ID')
    .argument('<channel-id>', 'Channel ID')
    .option('--after <date>', 'Date after which to retrieve history')
    .option('--before <date>', 'Date before which to retrieve history')
    .action( async (serverId, channelId, opts) => {
        await crawler(opts, 'channel',
        [
            new ChannelDiscordTask(serverId, channelId, opts.after, opts.before)
        ])
    });


addCommonOptions(program.command('thread'))
    .description('Download a single thread')
    .argument('<server-id>', 'Server ID')
    .argument('<channel-id>', 'Channel ID')
    .argument('<thread-id>', 'Thread ID')
    .action( async (serverId: string, channelId: string, threadId: string, opts) => {
        await crawler(opts, 'thread',
        [
            new ThreadDiscordTask(serverId, channelId, threadId)
        ])
    });

addCommonOptions(program.command('server'))
    .description('Download a single server')
    .argument('<server-id>', 'Server ID')
    .option('--after <date>', 'Date after which to retrieve history')
    .option('--before <date>', 'Date before which to retrieve history')
    .option('--threads-only', 'Retrieve only thread history, not channel history')
    .action( async (serverId, opts) => {
        await crawler(opts, 'server',
        [
            new ServerDiscordTask(serverId, opts.after, opts.before, opts.threadsOnly)
        ])
    });


addCommonOptions(program.command('resume'))
    .description('Resume an interrupted job')
    .argument('<path>', 'Job path')
    .action( async (path, opts) => {
        await crawler(opts, 'resume',
        [], path)
    });

program.command('reader')
    .description('Read completed job')
    .argument('<job-path>', 'Path to job directory')
    .addOption(
        new Option('-f, --format <format>', 'Output format')
            .choices(['print', 'jsonl', 'elasticsearch'])
    )
    .option('--debug', 'Output debug information')
    .action( async (jobPath, opts) => {
        const reader = new Reader(jobPath, opts.verbose, opts.debug, opts.format);
        await reader.read();
    })


// convenience function because Wireshark's open file dialogs
// are annoying
program.command('open-wireshark')
    .argument('<job-path>', 'Path to job directory')
    .action( async (jobPath: string, opts) => {
        const args = [
            // read capture file
            '-r', `${jobPath}/capture.pcapng`,
            // use ssl keylog file to decrypt TLS
            '-o', `tls.keylog_file:${jobPath}/sslkeys.pms`,
        ];
        spawn('wireshark', args);
    })

program.parse();