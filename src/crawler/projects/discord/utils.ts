import { Task } from '../../crawl';

export type DiscordID = string;

export function datetimeToDiscordSnowflake(date: Date): DiscordID {
    return (BigInt(date.getTime()) - BigInt("1420070400000") << BigInt(22)).toString();
}

export class DiscordTask extends Task {
}