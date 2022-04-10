import dotenv from 'dotenv';
import { Command, Option } from 'commander';
import { spawn } from 'child_process';

import { Crawler, Task } from './crawl';
import { DiscordProject, ProfileDiscordTask, ChannelDiscordTask, ServerDiscordTask } from './discord';
import { Reader } from './reader/reader';
import { DummyCaptureTool } from './captureTools/captureTools';
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

async function crawler(opts, mode: string, tasks: Task[]) {
    const crawler = new Crawler({
        project: new DiscordProject(opts.email, opts.password),
        tasks: tasks,
        mode: mode,
        browserDataDir: opts.browserDataDir,
        captureTool: captureTools[opts.captureTool],
        headless: opts.headless,
        blockImages: opts.blockImages,
    });

    await crawler.run();
}


addCommonOptions(program.command('profile'))
    .description('Log in and fetch profile information')
    .action( async (opts) => {
        await crawler(opts, 'profile', [])
    })


addCommonOptions(program.command('channel'))
    .description('Scrape a single channel')
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

addCommonOptions(program.command('server'))
    .description('Scrape a single server')
    .argument('<server-id>', 'Server ID')
    .option('--after <date>', 'Date after which to retrieve history')
    .option('--before <date>', 'Date before which to retrieve history')
    .action( async (serverId, opts) => {
        await crawler(opts, 'server',
        [
            new ServerDiscordTask(serverId, opts.after, opts.before)
        ])
    });


program.command('reader')
    .description('Read completed job')
    .argument('<job-path>', 'Path to job directory')
    .addOption(
        new Option('-f, --format <format>', 'Output format')
            .choices(['print', 'jsonl'])
    )
    .option('--verbose', 'Be verbose')
    .action( async (jobPath, opts) => {
        const reader = new Reader(jobPath, opts.verbose, opts.format);
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