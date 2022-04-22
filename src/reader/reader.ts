import { spawn } from 'child_process';
import * as fs from 'fs/promises';
//import zlib from 'zlib';

import { State } from '../crawl';

import { ReaderOutput } from './output';
import { readPcapng } from './tshark/tshark';
import { readMitmproxy } from './mitmproxy';

export enum OutputFormats {
    PRINT = 'print',
    JSONL = 'jsonl'
}

export class Reader {
    constructor(
        public path: string,
        public verbose: boolean = false,
        public debug: boolean = false,
        public outputFormat: OutputFormats = OutputFormats.PRINT,
        public outputFunction: (data: ReaderOutput) => void = null
    ) {}

    log(...args: unknown[]) {
        if (this.verbose && (this.outputFormat == OutputFormats.PRINT || this.outputFunction)) {
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
            if (this.outputFormat == OutputFormats.JSONL) {
                console.log(JSON.stringify(data));
            }
        }
    }

    async read() {
        const contents = await fs.readFile(`${this.path}/state.json`, 'utf8');
        const state = JSON.parse(contents) as State;
    
        this.log(`Loaded job ${state.job.name} (capture tool ${state.settings.captureToolName})`);

        if (state.settings.captureToolName == "Tshark") {
            await readPcapng(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else if (state.settings.captureToolName == "Mitmdump") {
            await readMitmproxy(this.path,
                this.log.bind(this), this.logDebug.bind(this), this.output.bind(this)
            );
        } else {
            throw new Error(`Unsupported capture tool: ${state.settings.captureToolName}`);
        }
    }

}