// XXX should be abstract class, but then we can't pass it around
export class CaptureTool {
    proxyServerAddress: string | null;
    replay: boolean = false;

    constructor(dataPath: string) {};
    async start(): Promise<void> {};
    async close(): Promise<void> {};
}

export class DummyCaptureTool extends CaptureTool {
    proxyServerAddress = null;
    
    async start() {
        console.log("Starting dummy capture tool")
    }
    
    async close() {
        console.log("Closing dummy capture tool")
    }
}