// XXX should be abstract class, but then we can't pass it around
export class CaptureTool {
    supportsReplay: boolean;
    proxyServerAddress: string | null;

    constructor(dataPath: string, replay?: boolean) {};
    async start(): Promise<void> {};
    async close(): Promise<void> {};
}

export class DummyCaptureTool extends CaptureTool {
    supportsReplay = false;
    proxyServerAddress = null;

    constructor(dataPath: string, replay?: boolean){
        super(dataPath, replay);
        if (replay && !this.supportsReplay) {
            throw new Error(`Capture tool ${this.constructor.name} does not support replay`);
        }
    }
    
    async start() {
        console.log("Starting dummy capture tool")
    }
    
    async close() {
        console.log("Closing dummy capture tool")
    }
}