import { Project, Task } from '../../crawl';
import { LoginDiscordTask } from './login';
import { ChannelDiscordTask, DMDiscordTask, ThreadDiscordTask } from './channel';
import { ServerDiscordTask } from './server';
import { ProfileDiscordTask } from './profile';

export { LoginDiscordTask, DMDiscordTask, ChannelDiscordTask, ThreadDiscordTask, ServerDiscordTask, ProfileDiscordTask };

//const discord_url = new URL("https://discord.com/");
//
//export class InitialDiscordTask extends DiscordTask {
//    type = "InitialDiscordTask";
//    async perform(crawler: CrawlerInterface) {
//        await retryGoto(crawler.page, discord_url);
//    }
//}    

export class DiscordProject implements Project {
    taskClasses = {
        LoginDiscordTask: LoginDiscordTask,
        ChannelDiscordTask: ChannelDiscordTask,
        DMDiscordTask: DMDiscordTask,
        ServerDiscordTask: ServerDiscordTask,
    };
    initialTasks: Task[];

    constructor(discordEmail: string, discordPassword: string) {
        if (!discordEmail || !discordPassword) {
            throw new Error("Discord email and password must be provided");
        }

        this.initialTasks = [
            //new InitialDiscordTask(),
            new LoginDiscordTask(discordEmail, discordPassword),
            new ProfileDiscordTask(discordEmail)
        ];
    }
}
