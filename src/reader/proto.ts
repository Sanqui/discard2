// Protocol handler for reader
// Heavily hardcoded for Discord capture processing

import { Buffer } from 'buffer';

import brotli from 'brotli';
import { gzip, ungzip } from 'node-gzip';
// Note: We have to use pako 1.x, the same version Discord
// uses, because later versions has different Z_SYNC_FLUSH
// handling https://github.com/nodeca/pako/issues/196
import pako from 'pako';
// XXX another option would be https://www.npmjs.com/package/zlib-sync

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
    timestamp_start: string;
    timestamp_end: string;
    id: number;
    constructor() {
        this.request = {};
        this.response = {};
    }
}

function hexToBuffer(hex: string): Buffer {
    return Buffer.from(hex.replace(/:/g, ''), 'hex')
}

export class ProtocolHandler {
    httpStreams: {[key: number]: HTTP2Stream} = {};
    discordWsStreamPort: number;
    discordWsStreamInflator: pako.Inflate;

    constructor(
        public log: Function,
        public output: Function
    ) {}

    async handleWebsocketPayload(isRequest: boolean, buffer: Buffer, timestamp: string) {
        let data: string;
        if (isRequest) {
            data = buffer.toString('utf-8');
        } else {
            this.discordWsStreamInflator.push(Uint8Array.from(buffer), true);
            if (this.discordWsStreamInflator.result) {
                data = this.discordWsStreamInflator.result.toString();
            }

            if (this.discordWsStreamInflator.err) {
                throw Error("WS stream inflate failed: " + this.discordWsStreamInflator.msg);
            }
        }

        if (data) {
            this.log(` .WS ${isRequest?">":"<"} ` + data.slice(0, 80) + "...");
            this.output(
                {
                    "type": "ws",
                    "timestamp": timestamp,
                    "direction": isRequest?"send":"recv",
                    "data": JSON.parse(data)
                }
            );
        } else {
            this.log(` .WS ${isRequest?">":"<"} `);
        }
    }

    async handleHttpStream(stream: HTTP2Stream) {
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
        
        if (requestHeaders[':path'].startsWith('/assets/')
        || requestHeaders[':path'].startsWith('/cdn-cgi/')
        || requestHeaders[':path'].startsWith('/login')
        || requestHeaders[':path'].startsWith('/api/v9/science')
        ) {
            return;
        }

        this.log(`> ${requestHeaders[':method']} ${requestHeaders[':path']}`);
        this.log(`< ${responseHeaders[':status']} (${responseHeaders['content-encoding'] || ''})`);

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

        let responseDataJson: string;
        if (requestHeaders[':path'].startsWith('/api/')) {
            responseDataJson = JSON.parse(responseData);
        }

        //this.log(" " + responseData);
        this.log(" " + responseData.slice(0, 80) + "...");
        this.output(
            {
                "type": "http",
                "timestamp_start": stream.timestamp_start, "timestamp_end": stream.timestamp_end,
                "request": {
                    "method": requestHeaders[':method'],
                    "url": requestHeaders[':path'],
                },
                "response": {
                    "status": responseHeaders[':status'],
                    "data": responseDataJson !== undefined ? responseDataJson : responseData
                }
            }
        );
    }

    async handlePacket(index: number, packet: any) {
        let layers = packet._source.layers;
        let timestamp = layers['frame']['frame.time_epoch'];
        let frameNum = layers['frame']['frame.number'];
        const isRequest = layers.ip['ip.src'] === CLIENT_IP;
    
        if (!isRequest && layers.http) {
            // Discord uses HTTP only for initiating websockets
            if (layers.http[0]['http.upgrade'] != 'websocket') return;
            if (!layers.http[0]['http.response_for.uri'].startsWith('https://gateway.discord.gg/')) return;
    
            this.discordWsStreamPort = layers.tcp['tcp.dstport'];
    
            this.discordWsStreamInflator = new pako.Inflate({
                chunkSize: 65536,
                to: "string"});
    
            // There's a first websocket packet following the 101 HTTP request
            // which Wireshark fails to recognize, but we need the data
    
            // Skip the first 2 bytes
            await this.handleWebsocketPayload(
                isRequest,
                hexToBuffer(layers.http[1]['data']['data.data'].slice(6)),
                timestamp
            );
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
                //this.log(`${isRequest?">":"<"} i${index} f${frameNum} - frame, streamid ${streamid}, type ${frameType}, end ${endStream}`);
    
                if (this.httpStreams[streamid] === undefined) {
                    this.httpStreams[streamid] = new HTTP2Stream();
                    this.httpStreams[streamid].id = streamid;
                    this.httpStreams[streamid].timestamp_start = timestamp;
                }
                let request = this.httpStreams[streamid][isRequest ? 'request' : 'response'];
                if (request[frameType]) {
                    throw new Error('Same frame type encountered multiple times for stream ' + streamid);
                }
                request[frameType] = frame;
    
                if (endStream && !isRequest) {
                    this.httpStreams[streamid].timestamp_end = timestamp;
                    await this.handleHttpStream(this.httpStreams[streamid]);
                    delete this.httpStreams[streamid];
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
    
            if (isRequest && layers.tcp['tcp.srcport'] != this.discordWsStreamPort
                || !isRequest && layers.tcp['tcp.dstport'] != this.discordWsStreamPort
            ) {
                return;
            }
    
            //this.log(`${isRequest?">":"<"} i${index} f${frameNum} WS`);
            //this.log(layers);
    
            let data = layers['websocket_data.data'];
    
            if (data) {
                if (Array.isArray(data) ) {
                    for (let d of data) {
                        await this.handleWebsocketPayload(isRequest, Buffer.from(d, 'hex'), timestamp);
                    }
                } else {
                    await this.handleWebsocketPayload(isRequest, Buffer.from(data, 'hex'), timestamp);
                }
    
            }
        }
    }
}