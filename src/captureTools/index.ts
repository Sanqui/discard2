// XXX should be abstract class, but then we can't pass it around
export class CaptureTool {
    name: string;
    proxyServerAddress: string | null;
    replay = false;

    constructor(dataPath: string) {}
    async start(): Promise<void> {}
    close(): void {}
}

export class DummyCaptureTool extends CaptureTool {
    name = "dummy";
    proxyServerAddress = null;
    
    async start() {
        console.log("Starting dummy capture tool")
    }
    
    close() {
        console.log("Closing dummy capture tool")
    }
}