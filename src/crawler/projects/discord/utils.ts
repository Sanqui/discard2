import { Task } from '../../crawl';

export function datetimeToDiscordSnowflake(date: Date) {
    return (BigInt(date.getTime()) - BigInt("1420070400000") << BigInt(22)).toString();
}

export class DiscordTask extends Task {
}