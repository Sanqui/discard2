import { spawn } from 'child_process';
import * as fs from 'fs/promises';

const {parser} = require('stream-json');
const {streamArray} = require('stream-json/streamers/StreamArray');

const CLIENT_IP = '10.0.2.100';

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
}

let streams: {[key: number]: HTTP2Stream} = {};

function handleStream(stream: HTTP2Stream) {
    let request_headers = {};
    for (let header of stream.request[HTTP2FrameType.HEADERS]['http2.header']) {
        request_headers[header['http2.header.name']] = header['http2.header.value'];
    }

    if (request_headers[':authority'] != "discord.com") return;
    
    console.log(`${request_headers[':method']} ${request_headers[':path']}`);
    // ...
}

let packetNum = 0;

function handlePacket(packet: any) {
    //console.log(JSON.stringify(packet));
    let layers = packet._source.layers;
    //let protocol = layers['_ws.col.Protocol'][0];
    if (layers.http2) {
        //console.log(packetNum, layers.ip['ip.src'], layers.ip['ip.dst']);
        const is_request = layers.ip['ip.src'] === CLIENT_IP;
        
        let packet_streams = layers.http2;
        if (packet_streams['http2.stream']) {
            packet_streams = packet_streams['http2.stream'];
        }
        if (!Array.isArray(packet_streams)) {
            packet_streams = [packet_streams];
        }
        for (let frame of packet_streams) {
            if (frame['http2.stream']) {
                frame = frame['http2.stream'];
            }
            const streamid = frame['http2.streamid'] as HTTP2FrameType;
            const frameType = frame['http2.type'] as number;
            const endStream = parseInt(frame['http2.flags'], 16) & 0x01;
            if (streamid === undefined) continue;
            if (frameType != HTTP2FrameType.DATA && frameType != HTTP2FrameType.HEADERS) continue;
            if (frameType == HTTP2FrameType.DATA && !endStream) {
                // tshark reassembles the complete data for us when the stream ends
                continue;
            }
            //console.log(`${is_request?">":"<"} ${packetNum} - frame, streamid ${streamid}, type ${frameType}, end ${endStream}`);

            if (streams[streamid] === undefined) {
                streams[streamid] = new HTTP2Stream();
            }
            let request = streams[streamid][is_request ? 'request' : 'response'];
            if (request[frameType]) {
                throw new Error('Same frame type encountered multiple times for stream ' + streamid);
            }
            request[frameType] = frame;

            if (parseInt(frame['http2.flags'], 16) & 0x01 && !is_request) {
                //console.log("End of stream " + streamid);
                handleStream(streams[streamid]);
                delete streams[streamid];
            }
        }
    }
    packetNum += 1;
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
        '-Y', 'http2 or websocket',
        // use the elasticsearch output format, which is newline separated JSON
        // well suited for streaming
        //'-T', 'ek', 
        // nvm we use normal json because it's impossible to wrestle the ek
        // format into giving us the fields we need
        '-T', 'json',
        // output arrays instead of duplicate keys in json
        '--no-duplicate-keys',
        // specify the protocol data we want to see
        '-j', 'ip http2 http2.stream http2.header',
        // Extract the fields that we're interested in
        /*...[
            'ip.src', 'ip.dst', 'http2', '_ws.col.Info', '_ws.col.Protocol',
            'http2.streamid', 'http2.headers.authority',
            'http2.headers.method', 'http2.headers.path', 'http2.headers.status'
        ].map(field => ['-e', field]).flat()*/
        // flush stdout after each packet for more reliable piping
        '-l',
    ];

    console.log("tshark args:", args.join(' '));

    let process = spawn('tshark', args);

    process.stdout.pipe(parser()).pipe(streamArray())
        .on('data', function(obj: {key: number, value: any}) {
            //console.log(obj.toString());
            handlePacket(obj.value);
        })
    ;
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