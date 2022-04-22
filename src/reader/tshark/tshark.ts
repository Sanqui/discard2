import { spawn } from 'child_process';

import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import { TsharkProtocolHandler } from './proto';
import { ReaderOutput } from '../output';

export async function readPcapng(
    path: string,
    log: (...args: unknown[]) => void,
    logDebug: (...args: unknown[]) => void,
    output: (data: ReaderOutput) => void
) {
    const protocolHandler = new TsharkProtocolHandler(
        log,
        logDebug,
        output
    );

    const args = [
        // read capture file
        '-r', `${path}/capture.pcapng`,
        // use ssl keylog file to decrypt TLS
        '-o', `tls.keylog_file:${path}/sslkeys.pms`,
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
        '-j', 'frame sll ip tcp http data http2 http2.stream http2.header http2.body.fragments websocket',
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