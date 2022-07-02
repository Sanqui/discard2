import { spawn } from 'child_process';
import * as fs from 'fs/promises';
//import zlib from 'zlib';
//import { Message } from 'discord.js';

import { CrawlerState } from '../crawler/crawl';

import { ReaderOutput } from './output';
import { readPcapng } from './tshark/tshark';
import { readMitmproxy } from './mitmproxy';

function messagesFromData(data: ReaderOutput): any[] {
    if (data.type == "http"
        && data.request.method == "GET"
        && data.request.path.match(/^\/api\/v9\/channels\/\d+\/messages/)
        && data.response.status_code == 200
    ) {
        return data.response.data as any[];
    }
    return [];
}

export enum OutputFormats {
    RAW_PRINT = 'raw-print',
    RAW_JSONL = 'raw-jsonl',
    PRINT = 'print',
    ELASTICSEARCH = 'elasticsearch',
    DERIVE_URLS = 'derive-urls'
}

const outputFunctions: {[key in OutputFormats]: (data: ReaderOutput, reader?: Reader) => void} = {
    [OutputFormats.RAW_PRINT]: (data: ReaderOutput) => {
        if (data.type == "http") {
            console.log(`HTTP > ${data.request.method} ${data.request.path}`);
            if (data.response) {
                let sample = JSON.stringify(data.response.data);
                if (sample.length > 80) {
                    sample = sample.slice(0, 80) + "…";
                }
                console.log(`HTTP < ${data.response.status_code} ${sample}`);
            }
        } else if (data.type == "ws") {
            let sample = JSON.stringify(data.data);
            if (sample.length > 80) {
                sample = sample.slice(0, 80) + "…";
            }
            console.log(`WS ${data.direction == 'send' ? ">" : "<"} ${sample}`);
        }
    },
    [OutputFormats.RAW_JSONL]: (data: ReaderOutput) => {
        console.log(JSON.stringify(data));
    },
    [OutputFormats.PRINT]: (data: ReaderOutput) => {
        if (data.type == "http") {
            for (const message of messagesFromData(data)) {
                console.log(
                    `[${message.timestamp}] ${message.channel_id}: <${message.author.username}#${message.author.discriminator}> ${message.content}`
                );
            }
        }
    },
    [OutputFormats.ELASTICSEARCH]: (data: ReaderOutput, reader: Reader) => {
        if (data.type == "http") {
            for (const message of messagesFromData(data)) {
                //const id = `${this.state.job.name}-${message['id']}`;
                const id = `${message['id']}`;
                console.log(JSON.stringify({
                    index: {
                        _index: "discord_messages",
                        _id: id,
                    }
                }));
                console.log(JSON.stringify({
                        job_name: reader.state.job.name,
                        datetime: data.timestamp_end,
                        data: message
                }));
            }
        }
    },
    [OutputFormats.DERIVE_URLS]: (data: ReaderOutput) => {
        if (data.type == "http") {
            for (const message of messagesFromData(data)) {
                // Things which generate URLs: attachments, emoji, stickers, user avatars,
                // server banners, server icons, role icons, user profile banners
                for (const message of messagesFromData(data)) {
                    for (const attachment of message.attachments) {
                        if (attachment.url) {
                            console.log(attachment.url);
                        }
                    }
                }
            }
        }
    }
}

export class Reader {
    state: CrawlerState;

    constructor(
        public path: string,
        public debug: boolean = false,
        public outputFormat: OutputFormats = OutputFormats.PRINT,
        public outputFunction: (data: ReaderOutput) => void = null
    ) {}

    log(...args: unknown[]) {
        if (this.outputFormat == OutputFormats.PRINT) {
            console.log(...args)
        }
    }

    logDebug(...args: unknown[]) {
        if (this.debug) {
            console.log("DEBUG:", ...args)
        }
    }

    output(data: ReaderOutput) {
        if (this.outputFunction) {
            this.outputFunction(data);
        } else {
            outputFunctions[this.outputFormat](data, this);
        }
    }

    async read() {
        const contents = await fs.readFile(`${this.path}/state.json`, 'utf8');
        this.state = JSON.parse(contents) as CrawlerState;
    
        const captureToolName = this.state.settings.captureTool.name.toLowerCase();
        this.log(`Loaded job ${this.state.job.name} (capture tool ${captureToolName})`);

        if (captureToolName == "tshark") {
            await readPcapng(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else if (captureToolName == "mitmdump") {
            await readMitmproxy(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else {
            throw new Error(`Unsupported capture tool: ${captureToolName}`);
        }
    }

}