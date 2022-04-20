import { spawn } from 'child_process';
import * as fs from 'fs/promises';
//import zlib from 'zlib';

import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { State } from '../crawl';

import { ProtocolHandler, ReaderOutput } from './proto';
export { ReaderOutput } from './proto';

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
    
        this.log(`Loaded job ${state.job.name}`);

        const protocolHandler = new ProtocolHandler(
            this.log.bind(this),
            this.logDebug.bind(this),
            this.output.bind(this)
        );
    
        const args = [
            // read capture file
            '-r', `${this.path}/capture.pcapng`,
            // use ssl keylog file to decrypt TLS
            '-o', `tls.keylog_file:${this.path}/sslkeys.pms`,
            // reassemble out of order TCP segments
            // see https://www.wireshark.org/docs/wsug_html_chunked/ChAdvReassemblySection
            '-o', 'tcp.reassemble_out_of_order:true',
            // filter http2 or websocket packets
            '-Y', 'http or http2 or websocket',
            // use the JSON output format
            '-T', 'json',
            // output arrays instead of duplicate keys in json
            '--no-duplicate-keys',
            // specify the protocol data we want to see
            '-j', 'frame ip tcp http data http2 http2.stream http2.header http2.body.fragments websocket',
            // flush stdout after each packet for more reliable piping
            '-l',
            // wireshark by default, for some ridiculous reason,
            // truncates websocket text data
            // include a lua script to fix this
            '-Xlua_script:wireshark/ws.lua'
        ];
    
        //this.log("tshark args:", args.join(' '));
    
        const process = spawn('tshark', args);
        
        process.on('exit', code => {
            if (code != 0 && code != 255) {
                console.error("tshark stderr: " + process.stderr.read().toString());
                throw new Error(`tshark exited with code ${code}`);
            }
        });
    
        for await (const obj of process.stdout.pipe(parser()).pipe(streamArray())) {
            await protocolHandler.handlePacket(obj.key, obj.value);
        }
    }

}