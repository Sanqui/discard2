import { spawn } from 'child_process';
import * as fs from 'fs/promises';
//import zlib from 'zlib';

import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';

import { ProtocolHandler } from './proto';

enum OutputFormats {
    PRINT = 'print',
    JSONL = 'jsonl'
}

export class Reader {
    constructor(
        public path: string,
        public verbose: boolean = false,
        public outputFormat: OutputFormats = OutputFormats.PRINT
    ) {}

    async log(...args: any[]) {
        if (this.verbose && this.outputFormat == OutputFormats.PRINT) {
            console.log(...args)
        }
    }

    async output(data: any) {
        if (this.outputFormat == OutputFormats.JSONL) {
            console.log(JSON.stringify(data));
        }
    }

    async read() {
        let contents = await fs.readFile(`${this.path}/state.json`, 'utf8');
        let state = JSON.parse(contents);
    
        this.log(`Loaded job ${state.jobName}`);

        let protocolHandler = new ProtocolHandler(
            this.log.bind(this),
            this.output.bind(this)
        );
    
        let args = [
            // read capture file
            '-r', `${this.path}/capture.pcapng`,
            // use ssl keylog file to decrypt TLS
            '-o', `tls.keylog_file:${this.path}/sslkeys.pms`,
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
    
        let process = spawn('tshark', args);
    
        for await (const obj of process.stdout.pipe(parser()).pipe(streamArray())) {
            await protocolHandler.handlePacket(obj.key, obj.value);
        }
        
        process.on('exit', code => {
            if (code != 0 && code != 255) {
                console.error("tshark stderr: " + process.stderr.read().toString());
                throw new Error(`tshark exited with code ${code}`);
            }
        });
    }

}