import { spawn } from 'child_process';

import ZlibSync = require("zlib-sync");
import JsonlParser from 'stream-json/jsonl/Parser';

import { ReaderOutput, ReaderOutputWsCompressed } from './output';

export async function readMitmproxy(
    path: string,
    log: (...args: unknown[]) => void,
    logDebug: (...args: unknown[]) => void,
    output: (data: ReaderOutput) => void
) {
    const process = spawn('python', [
        'mitmproxy/read.py',
        path + '/capture.mitmdump'
    ]);

    process.on('exit', code => {
        if (code != 0 && code != 255) {
            console.error("mitmproxy read stderr: " + process.stderr.read().toString());
            throw new Error(`mitmproxy read exited with code ${code}`);
        }
    });

    let discordWsStreamInflator = new ZlibSync.Inflate();

    let obj: ReaderOutput | ReaderOutputWsCompressed;
    for await ({value: obj} of process.stdout.pipe(new JsonlParser())) {
        if (obj.type == "http" || obj.type == "ws") {
            output(obj);
        } else if (obj.type == "ws_compressed") {
            discordWsStreamInflator.push(Buffer.from(obj.compressed_data, 'hex'), ZlibSync.Z_SYNC_FLUSH);

            if (discordWsStreamInflator.err) {
                // This is a silly solution that will bite us if we ever have interleaved WS streams,
                // but it'll do for sequential ones for now.
                // We'll try to create a new WS stream inflator and decode using that one.
                // Only fail if that one fails too.
                    
                discordWsStreamInflator = new ZlibSync.Inflate();
                discordWsStreamInflator.push(Buffer.from(obj.compressed_data, 'hex'), ZlibSync.Z_SYNC_FLUSH);

                if (discordWsStreamInflator.err) {
                    throw Error(`WS stream inflate failed: ${discordWsStreamInflator.msg}`);
                }
            }

            const data = JSON.parse(discordWsStreamInflator.result?.toString()) as unknown;
            output({
                type: "ws",
                timestamp: obj.timestamp,
                direction: obj.direction,
                data
            });
        }
    }
}