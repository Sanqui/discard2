import pressAnyKey from 'press-any-key';
import dotenv from 'dotenv';
import { Command, Option } from 'commander';

import { Crawler, Task } from './crawl';
import { DiscordProject, ProfileDiscordTask, ChannelDiscordTask } from './discord';
import { read } from './reader';
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

    try {
        await crawler.run();
    } catch (error) {
        console.log("Caught error: " + error.message);
        await pressAnyKey("Press any key to exit...");
        throw error;
    }
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


program.command('reader')
    .description('Read completed job')
    .argument('<job-path>', 'Path to job directory')
    .action( async (jobPath, opts) => {
        read(jobPath);
    })

program.parse();