import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import { Buffer } from 'buffer';
//import zlib from 'zlib';

import { parser } from 'stream-json';
import { streamArray } from 'stream-json/streamers/StreamArray';
import brotli from 'brotli';
import { gzip, ungzip } from 'node-gzip';
// Note: We have to use pako 1.x, the same version Discord
// uses, because later versions has different Z_SYNC_FLUSH
// handling https://github.com/nodeca/pako/issues/196
import pako from 'pako';

const CLIENT_IP = '10.0.2.100';

enum WebsocketOpcode {
    CONTINUATION = 0x0,
    TEXT = 0x1,
    BINARY = 0x2
}

type HTTP2Frame = any;

enum HTTP2FrameType {
    DATA = 0,
    HEADERS = 1,
    PRIORITY = 2,
    RST_STREAM = 3
}

type HTTP2Request = {[key: number]: HTTP2Frame};

class HTTP2Stream {
    request: HTTP2Request;
    response: HTTP2Request;
    constructor() {
        this.request = {};
        this.response = {};
    }
    id: number;
}

let streams: {[key: number]: HTTP2Stream} = {};
let discordWsStreamPort: number;
let discordWsStreamInflator: pako.Inflate;

function hexToBuffer(hex: string): Buffer {
    return Buffer.from(hex.replace(/:/g, ''), 'hex')
}

process.on('unhandledRejection', (error: any, p) => {
    console.log('=== UNHANDLED REJECTION ===');
    console.dir(error);
    throw Error();
  });

async function handleWebsocketPayload(isRequest: boolean, buffer: Buffer) {
    let data: string;
    if (isRequest) {
        data = buffer.toString('utf-8');
    } else {
        discordWsStreamInflator.push(Uint8Array.from(buffer), true);
        if (discordWsStreamInflator.result) {
            console.log('result');
            data = discordWsStreamInflator.result.toString();
        }

        if (discordWsStreamInflator.err) {
            throw Error("WS stream inflate failed: " + discordWsStreamInflator.msg);
        }
    }

    if (data) {
        console.log(` .WS ${isRequest?">":"<"} ` + data.slice(0, 80) + "...");
    } else {
        console.log(` .WS ${isRequest?">":"<"} `);
    }
}

async function handleStream(stream: HTTP2Stream) {
    function convertHeaders(headers) {
        let result = {};
        for (let header of headers) {
            result[header['http2.header.name']] = header['http2.header.value'];
        }
        return result;
    }
    let requestHeaders = convertHeaders(stream.request[HTTP2FrameType.HEADERS]['http2.header']);
    if (stream.response[HTTP2FrameType.HEADERS] == undefined) {
        throw new Error('No response headers in stream ' + stream.id);
    }
    let responseHeaders = convertHeaders(stream.response[HTTP2FrameType.HEADERS]['http2.header']);

    if (requestHeaders[':authority'] != "discord.com") return;
    
    if (requestHeaders[':path'].startsWith('/assets/')) return;

    console.log(`> ${requestHeaders[':method']} ${requestHeaders[':path']}`);
    console.log(`< ${responseHeaders[':status']} (${responseHeaders['content-encoding'] || ''})`);

    if (responseHeaders[':status'] != '200') return;

    if (stream.response[HTTP2FrameType.DATA] === undefined
        || stream.response[HTTP2FrameType.DATA]['http2.body.fragments'] === undefined
        || stream.response[HTTP2FrameType.DATA]['http2.body.fragments']['http2.body.reassembled.data'] === undefined
    ) {
        throw new Error('No data in response in stream ' + stream.id);
    }
    let responseBodyData = stream.response[HTTP2FrameType.DATA]['http2.body.fragments']['http2.body.reassembled.data'];

    let responseDataBuffer = hexToBuffer(responseBodyData);
    let responseData: string;
    if (responseHeaders['content-encoding'] == "br") {
        responseData = Buffer.from(brotli.decompress(responseDataBuffer)).toString();
    } else if (responseHeaders['content-encoding'] == "gzip") {
        responseData = (await ungzip(responseDataBuffer)).toString();
    } else if (!responseHeaders['content-encoding']) {
        responseData = responseDataBuffer.toString();
    } else {
        throw Error("Unsupported content encoding: " + responseHeaders['content-encoding']);
    }

    //console.log(" " + responseData);
    console.log(" " + responseData.slice(0, 80) + "...");
}

async function handlePacket(index: number, packet: any) {
    let layers = packet._source.layers;
    let frameNum = layers['frame']['frame.number'];
    const isRequest = layers.ip['ip.src'] === CLIENT_IP;

    if (!isRequest && layers.http) {
        // Discord uses HTTP only for initiating websockets
        if (layers.http[0]['http.upgrade'] != 'websocket') return;
        if (!layers.http[0]['http.response_for.uri'].startsWith('https://gateway.discord.gg/')) return;

        discordWsStreamPort = layers.tcp['tcp.dstport'];

        discordWsStreamInflator = new pako.Inflate({
            chunkSize: 65536,
            to: "string"});

        // There's a first websocket packet following the 101 HTTP request
        // which Wireshark fails to recognize, but we need the data

        // Skip the first 2 bytes
        await handleWebsocketPayload(isRequest, hexToBuffer(layers.http[1]['data']['data.data'].slice(6)));
    }
    else if (layers.http2) {
        // ridiculous what we have to do because of tshark output
        let packet_streams = layers.http2;
        let framesInPacket = [];
        if (packet_streams['http2.stream']) {
            packet_streams = packet_streams['http2.stream'];
        }
        if (!Array.isArray(packet_streams)) {
            packet_streams = [packet_streams];
        }
        for (let stream of packet_streams) {
            if (stream['http2.stream']) {
                if (Array.isArray(stream['http2.stream'])) {
                    framesInPacket = framesInPacket.concat(stream['http2.stream']);
                } else {
                    framesInPacket.push(stream['http2.stream']);
                }
            } else {
                framesInPacket.push(stream);
            }
        }
        for (let frame of framesInPacket) {
            // TODO handle fragmented headers
            const streamid = frame['http2.streamid'] as HTTP2FrameType;
            const frameType = frame['http2.type'] as number;
            const endStream = parseInt(frame['http2.flags'], 16) & 0x01;
            if (streamid === undefined) continue;
            if (frameType != HTTP2FrameType.DATA && frameType != HTTP2FrameType.HEADERS) continue;
            if (frameType == HTTP2FrameType.DATA && !endStream) {
                // tshark reassembles the complete data for us when the stream ends
                continue;
            }
            //console.log(`${isRequest?">":"<"} i${index} f${frameNum} - frame, streamid ${streamid}, type ${frameType}, end ${endStream}`);

            if (streams[streamid] === undefined) {
                streams[streamid] = new HTTP2Stream();
                streams[streamid].id = streamid;
            }
            let request = streams[streamid][isRequest ? 'request' : 'response'];
            if (request[frameType]) {
                throw new Error('Same frame type encountered multiple times for stream ' + streamid);
            }
            request[frameType] = frame;

            if (endStream && !isRequest) {
                await handleStream(streams[streamid]);
                delete streams[streamid];
            }
        }
    } else if (layers.websocket) {
        // TODO verify host
        // TODO currently we expect the client to always send text data,
        // and the server to send binary data, but we should check the opcode
        // TODO currently we expect the server to always send
        // zlib compressed data, but we should check against the URL
        // (typically wss://gateway.discord.gg/?encoding=json&v=9&compress=zlib-stream)
        // TODO verify for "fin" flag

        if (isRequest && layers.tcp['tcp.srcport'] != discordWsStreamPort
            || !isRequest && layers.tcp['tcp.dstport'] != discordWsStreamPort
        ) {
            return;
        }

        //console.log(`${isRequest?">":"<"} i${index} f${frameNum} WS`);
        //console.log(layers);

        let data = layers['websocket_data.data'];

        if (data) {
            if (Array.isArray(data) ) {
                for (let d of data) {
                    await handleWebsocketPayload(isRequest, Buffer.from(d, 'hex'));
                }
            } else {
                await handleWebsocketPayload(isRequest, Buffer.from(data, 'hex'));
            }

        }
    }
}

export async function read(path: string) {
    let contents = await fs.readFile(`${path}/state.json`, 'utf8');
    let state = JSON.parse(contents);

    console.log(`Loaded job ${state.jobName}`);

    // In the future, we want to implement streaming reading
    // but for now, we read everything at once and then process it...

    let args = [
        // read capture file
        '-r', `${path}/capture.pcapng`,
        // use ssl keylog file to decrypt TLS
        '-o', `tls.keylog_file:${path}/sslkeys.pms`,
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

    console.log("tshark args:", args.join(' '));

    let process = spawn('tshark', args);

    for await (const obj of process.stdout.pipe(parser()).pipe(streamArray())) {
        await handlePacket(obj.key, obj.value);
    }
    ///process.stdout.on('data', (data) => {
    ///    tshark_data += data.toString();
    ///})
    
    process.on('exit', code => {
        //if (code == 0) {
        //    parseData(JSON.parse(tshark_data));
        //}
        if (code != 0 && code != 255) {
            console.log("tshark stderr: " + process.stderr.read().toString());
            throw new Error(`tshark exited with code ${code}`);
        }
    });
    
    
    //tshark -r capture.pcapng -o "tls.keylog_file:sslkeys.pms" -P -Y "http2 or websocket"
}