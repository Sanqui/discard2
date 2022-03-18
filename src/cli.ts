import pressAnyKey from 'press-any-key';
import dotenv from 'dotenv';
import { Command, Option } from 'commander';

import { Crawler } from './crawl';
import { DiscordProject, ProfileDiscordTask } from './discord';

dotenv.config();

const program = new Command();

program
    .name('discard2')
    .description('Discord archival tool')
    .addOption(
        new Option('-e, --email <email>', 'Discord account email').env('DISCORD_EMAIL').makeOptionMandatory()
    )
    .addOption(
        new Option('-p, --password <password>', 'Discord account password').env('DISCORD_PASSWORD').makeOptionMandatory()
    )
    .addOption(
        new Option('-b, --browser-data-dir <path>', 'Browser data directory').env('BROWSER_DATA_DIR').makeOptionMandatory()
    );

program.command('profile')
    .description('Log in and fetch profile information')
    .action(async () => {
        const crawler = new Crawler({
            project: new DiscordProject(program.opts().email, program.opts().password),
            tasks: [new ProfileDiscordTask()],
            mode: 'profile',
            browserDataDir: program.opts().browserDataDir
        });

        try {
            await crawler.run();
        } catch (error) {
            console.log("Caught error: " + error.message);
            await pressAnyKey("Press any key to exit...");
            throw error;
        }
});

program.parse();