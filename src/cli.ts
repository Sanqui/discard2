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
            new Option('-b, --browser-data-dir <path>', 'Browser data directory').env('BROWSER_DATA_DIR').makeOptionMandatory()
        )
        .addOption(
            new Option('-c, --capture-tool <tool>', 'Capture tool')
                .choices(['none', 'mitmdump', 'tshark'])
                .env('CAPTURE_TOOL').makeOptionMandatory()
        )
        .option('--headless', 'Run in headless mode')
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
    });

    await crawler.run();
}


addCommonOptions(program.command('profile'))
    .description('Log in and fetch profile information')
    .action( async (opts) => {
        crawler(opts, 'profile', [])
    })


addCommonOptions(program.command('channel'))
    .description('Scrape a single channel')
    .argument('<server-id>', 'Server ID')
    .argument('<channel-id>', 'Channel ID')
    .option('--after <date>', 'Date after which to retrieve history')
    .option('--before <date>', 'Date before which to retrieve history')
    .action( async (serverId, channelId, opts) => {
        crawler(opts, 'channel',
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
        crawler(opts, 'channel',
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
        let reader = new Reader(jobPath, opts.verbose, opts.format);
        reader.read();
    })


// convenience function because Wireshark's open file dialogs
// are annoying
program.command('open-wireshark')
    .argument('<job-path>', 'Path to job directory')
    .action( async (jobPath, opts) => {
        let args = [
            // read capture file
            '-r', `${jobPath}/capture.pcapng`,
            // use ssl keylog file to decrypt TLS
            '-o', `tls.keylog_file:${jobPath}/sslkeys.pms`,
        ];
        spawn('wireshark', args);
    })

program.parse();