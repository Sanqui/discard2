// Tshark Protocol handler for reader
// Heavily hardcoded for Discord capture processing

import { Buffer } from 'buffer';
import equal from 'deep-equal';

import brotli from 'brotli';
import { ungzip } from 'node-gzip';
import ZlibSync = require("zlib-sync");

import { ReaderOutput } from '../output';

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

type IPAddress = string;
type PortNumber = number;
type IPPort = {
    ip: IPAddress,
    port: PortNumber
};
type ConnectionIdentifier = {
    addrClient: IPPort,
    addrServer: IPPort
};

class HTTP2Connection {
    streams: {[key: number]: HTTP2Stream};
    constructor(
        public connection: ConnectionIdentifier
    ) {
        this.streams = {};
    }
}

function hexToBuffer(hex: string): Buffer {
    return Buffer.from(hex.replace(/:/g, ''), 'hex')
}

export class TsharkProtocolHandler {
    httpConnections: Map<ConnectionIdentifier, HTTP2Connection>;
    discordWsStreamPort: number;
    discordWsStreamInflator: any;

    constructor(
        public log: (...args: unknown[]) => void,
        public logDebug: (...args: unknown[]) => void,
        public output: (data: ReaderOutput) => void
    ) {
        this.httpConnections = new Map();
    }

    handleWebsocketPayload(isRequest: boolean,
            buffer: Buffer,
            timestamp: string,
            flush = true
    ) {
        let data: string;
        if (isRequest) {
            data = buffer.toString('utf-8');
        } else {
            this.discordWsStreamInflator.push(Uint8Array.from(buffer), flush ? ZlibSync.Z_SYNC_FLUSH : null);

            data = this.discordWsStreamInflator.result?.toString();

            if (this.discordWsStreamInflator.err) {
                throw Error("WS stream inflate failed: " + this.discordWsStreamInflator.msg);
            }
        }

        if (data) {
            this.output(
                {
                    "type": "ws",
                    "timestamp": timestamp,
                    "direction": isRequest?"send":"recv",
                    "data": JSON.parse(data)
                }
            );
        }
    }

    async handleHttpStream(stream: HTTP2Stream) {
        function convertHeaders(headers) {
            const result: {[key in string]: string} = {};
            for (const header of headers) {
                result[header['http2.header.name'] as string] = header['http2.header.value'] as string;
            }
            return result;
        }
        if (!stream.request[HTTP2FrameType.HEADERS]) {
            console.log(`Warning: No request headers in http2 stream ${stream.id}`);
            return;
        }
        const requestHeaders = convertHeaders(stream.request[HTTP2FrameType.HEADERS]['http2.header']);
        if (stream.response[HTTP2FrameType.HEADERS] == undefined) {
            throw new Error(`No response headers in stream ${stream.id}`);
        }
        const responseHeaders = convertHeaders(stream.response[HTTP2FrameType.HEADERS]['http2.header']);

        if (requestHeaders[':authority'] != "discord.com") return;
        
        if (requestHeaders[':path'].startsWith('/assets/')
        || requestHeaders[':path'].startsWith('/cdn-cgi/')
        || requestHeaders[':path'].startsWith('/login')
        || requestHeaders[':path'].startsWith('/api/v9/science')
        ) {
            return;
        }

        if (responseHeaders[':status'] != '200') return;

        if (stream.response[HTTP2FrameType.DATA] === undefined
            || stream.response[HTTP2FrameType.DATA]['http2.body.fragments'] === undefined
            || stream.response[HTTP2FrameType.DATA]['http2.body.fragments']['http2.body.reassembled.data'] === undefined
        ) {
            throw new Error('No data in response in stream ' + stream.id);
        }
        const responseBodyData = stream.response[HTTP2FrameType.DATA]['http2.body.fragments']['http2.body.reassembled.data'];

        const responseDataBuffer = hexToBuffer(responseBodyData);
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

        let responseDataJson: unknown;
        if (requestHeaders[':path'].startsWith('/api/')) {
            responseDataJson = JSON.parse(responseData);
        }

        this.output(
            {
                "type": "http",
                "timestamp_start": stream.timestamp_start, "timestamp_end": stream.timestamp_end,
                "request": {
                    "method": requestHeaders[':method'],
                    "path": requestHeaders[':path'],
                },
                "response": {
                    "status_code": parseInt(responseHeaders[':status']),
                    "data": responseDataJson ?? responseData
                }
            }
        );
    }

    async handlePacket(index: number, packet: unknown) {
        const layers = packet['_source']['layers'] as unknown;
        const timestamp = layers['frame']['frame.time_epoch'] as string;
        const frameNum = layers['frame']['frame.number'] as number;

        let isRequest = false;
        if (layers['sll']['sll.hatype'] == "772") {
            // loopback
            isRequest = layers['tcp']['tcp.dstport'] == '8080';
        } else {
            isRequest = layers['sll']['sll.pkttype'] == '4'; // Packet type: "Sent by us"
        }

        if (layers['tcp']['tcp.analysis.lost_segment']) {
            this.log(`Warning: tshark reports lost TCP segment: ${timestamp} ${index} ${frameNum}`);
            return;
        }
    
        if (layers['http'] && !layers['http2']) {
            // Discord uses HTTP only for initiating websockets
            if (!layers['http'][0]) return; // Possibly a proxy request
            if (layers['http'][0]['http.upgrade'] != 'websocket') return;
            if (!layers['http'][0]['http.response_for.uri'].startsWith('https://gateway.discord.gg/')) return;
    
            this.discordWsStreamPort = layers['tcp']['tcp.dstport'] as number;
    
            this.discordWsStreamInflator = new ZlibSync.Inflate();
    
            // There's a first websocket packet following the 101 HTTP request
            // which Wireshark fails to recognize, but we need the data
    
            // Skip the first 2 bytes
            this.handleWebsocketPayload(
                false,
                hexToBuffer(layers['http'][1]['data']['data.data'].slice(6)),
                timestamp
            );
        }
        else if (layers['http2']) {
            const addrSrc: IPPort = {ip: layers['ip']['ip.src'] as string, port: layers['tcp']['tcp.srcport'] as number};
            const addrDst: IPPort = {ip: layers['ip']['ip.dst'] as string, port: layers['tcp']['tcp.dstport'] as number};
            let httpConnection: HTTP2Connection;
            for (const [c, hc] of this.httpConnections) {
                if (equal(c.addrClient, addrSrc) && equal(c.addrServer, addrDst)
                    || equal(c.addrClient, addrDst) && equal(c.addrServer, addrSrc))
                {
                    httpConnection = hc;
                }
            }
            if (!httpConnection) {
                const connection = {
                    addrClient: isRequest ? addrSrc : addrDst,
                    addrServer: isRequest ? addrDst : addrSrc
                };
                //this.log("New HTTP connection: " + JSON.stringify(connection));
                httpConnection = new HTTP2Connection(connection);
                this.httpConnections.set(connection, httpConnection);
            }
            //this.logDebug(`${isRequest?">":"<"} i${index} f${frameNum} http2`);
            // ridiculous what we have to do because of tshark output
            let packet_streams = layers['http2'];
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
            for (const frame of framesInPacket) {
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
                this.logDebug(`${isRequest?">":"<"} i${index} f${frameNum} - http2 frame, streamid ${streamid}, type ${frameType}, end ${endStream}`);
    
                if (httpConnection.streams[streamid] === undefined) {
                    httpConnection.streams[streamid] = new HTTP2Stream();
                    httpConnection.streams[streamid].id = streamid;
                    httpConnection.streams[streamid].timestamp_start = timestamp;
                }
                const request = httpConnection.streams[streamid][isRequest ? 'request' : 'response'];
                if (request[frameType]) {
                    throw new Error(`Same frame type encountered multiple times for stream ${streamid}`);
                }
                request[frameType] = frame as unknown;
    
                if (endStream && !isRequest) {
                    httpConnection.streams[streamid].timestamp_end = timestamp;
                    await this.handleHttpStream(httpConnection.streams[streamid]);
                    delete httpConnection.streams[streamid];
                }
            }
        } else if (layers['websocket']) {
            // TODO verify host
            // TODO currently we expect the client to always send text data,
            // and the server to send binary data, but we should check the opcode
            // TODO currently we expect the server to always send
            // zlib compressed data, but we should check against the URL
            // (typically wss://gateway.discord.gg/?encoding=json&v=9&compress=zlib-stream)
            // TODO verify for "fin" flag

            if (!this.discordWsStreamPort) return;
    
            this.logDebug(`${isRequest?">":"<"} i${index} f${frameNum} WS`);
            //this.log(layers);
    
            const data = layers['websocket_data.data'] as string | [];
    
            if (data) {
                if (Array.isArray(data) ) {
                    for (const d of data) {
                        this.handleWebsocketPayload(isRequest, Buffer.from(d, 'hex'), timestamp);
                    }
                } else {
                    this.handleWebsocketPayload(isRequest, Buffer.from(data, 'hex'), timestamp);
                }
    
            }
        }
    }
}