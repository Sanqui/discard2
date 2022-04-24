import { spawn } from 'child_process';
import * as fs from 'fs/promises';
//import zlib from 'zlib';

import { State } from '../crawl';

import { ReaderOutput } from './output';
import { readPcapng } from './tshark/tshark';
import { readMitmproxy } from './mitmproxy';

export enum OutputFormats {
    PRINT = 'print',
    JSONL = 'jsonl',
    ELASTICSEARCH = 'elasticsearch',
    DERIVE_URLS = 'derive-urls'
}

export class Reader {
    state: State;

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
            if (this.outputFormat == OutputFormats.PRINT) {
                if (data.type == "http") {
                    this.log(`HTTP > ${data.request.method} ${data.request.path}`);
                    if (data.response) {
                        let sample = JSON.stringify(data.response.data);
                        if (sample.length > 80) {
                            sample = sample.slice(0, 80) + "…";
                        }
                        this.log(`HTTP < ${data.response.status_code} ${sample}`);
                    }
                } else if (data.type == "ws") {
                    let sample = JSON.stringify(data.data);
                    if (sample.length > 80) {
                        sample = sample.slice(0, 80) + "…";
                    }
                    this.log(`WS ${data.direction == 'send' ? ">" : "<"} ${sample}`);
                }
            } else if (this.outputFormat == OutputFormats.JSONL) {
                console.log(JSON.stringify(data));
            } else if (this.outputFormat == OutputFormats.ELASTICSEARCH) {
                if (data.type == "http"
                    && data.request.method == "GET"
                    && data.request.path.match(/^\/api\/v9\/channels\/\d+\/messages/)
                    && data.response.status_code == 200
                ) {
                    for (const message of data.response.data as any[]) {
                        //const id = `${this.state.job.name}-${message['id']}`;
                        const id = `${message['id']}`;
                        console.log(JSON.stringify({
                            index: {
                                _index: "discord_messages",
                                _id: id,
                            }
                        }));
                        console.log(JSON.stringify({
                               job_name: this.state.job.name,
                               datetime: data.timestamp_end,
                               data: message
                        }));
                    }
                }
            }
        }
    }

    async read() {
        const contents = await fs.readFile(`${this.path}/state.json`, 'utf8');
        this.state = JSON.parse(contents) as State;
    
        this.log(`Loaded job ${this.state.job.name} (capture tool ${this.state.settings.captureToolName})`);

        if (this.state.settings.captureToolName == "Tshark") {
            await readPcapng(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else if (this.state.settings.captureToolName == "Mitmdump") {
            await readMitmproxy(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else {
            throw new Error(`Unsupported capture tool: ${this.state.settings.captureToolName}`);
        }
    }

}