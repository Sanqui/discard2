export interface ReaderOutputHttp {
    type: "http",
    timestamp_start: string,
    timestamp_end: string,
    request: {
        method: string,
        path: string,
    },
    response: {
        status_code: number,
        data: unknown
    }
}

export interface ReaderOutputWsCompressed {
    type: "ws_compressed",
    timestamp: string,
    direction: "send" | "recv",
    compressed_data: string
}

interface ReaderOutputWs {
    type: "ws",
    timestamp: string,
    direction: "send" | "recv",
    data: unknown
}

export type ReaderOutput = ReaderOutputHttp | ReaderOutputWs;