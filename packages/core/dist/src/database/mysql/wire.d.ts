import { type Socket } from 'node:net';
import { Readable } from 'node:stream';
interface ServerGreeting {
    protocolVersion: number;
    serverVersion: string;
    connectionId: number;
    authPluginData: Buffer;
    capabilityFlags: number;
    charset: number;
    statusFlags: number;
    authPluginName: string;
}
export declare class MysqlResultStream extends Readable {
    private _done;
    constructor();
    pushRow(row: Record<string, string | null>): boolean;
    finalize(error?: Error): void;
    _read(_size: number): void;
}
export interface MysqlConnectOptions {
    host: string;
    port?: number;
    user: string;
    password: string;
    database: string;
    connectTimeoutMs?: number;
}
type ConnState = 'connecting' | 'authenticating' | 'ready' | 'query' | 'closed';
export declare class MysqlConnection {
    protected socket: Socket | null;
    protected state: ConnState;
    private buffer;
    protected greeting: ServerGreeting | null;
    private opts;
    private authResolve;
    private authReject;
    private pendingQuery;
    private streamTarget;
    private columns;
    private colCount;
    private colsReceived;
    private expectEof;
    private pendingPrepare;
    private sha2State;
    private sha2Seed;
    private seq;
    get isReady(): boolean;
    get isClosed(): boolean;
    /** The server version string from the greeting packet. */
    get serverVersion(): string;
    /**
     * Static factory: connects to MySQL/MariaDB and returns the appropriate
     * subclass based on the server greeting (task 6.7).
     */
    static connect(opts: MysqlConnectOptions): Promise<MysqlConnection>;
    /** @internal Used by MariaDbConnection to take over a connected MysqlConnection. */
    _transferFrom(other: MysqlConnection): void;
    protected _connect(opts: MysqlConnectOptions): Promise<void>;
    private _onData;
    private _processBuffer;
    private _inExec;
    private _handlePacket;
    private _handleAuthPacket;
    private _handleQueryPacket;
    private _handlePreparePacket;
    private _completePrepare;
    private execColumns;
    private execColCount;
    private execColsReceived;
    private execExpectRows;
    private execPendingQuery;
    private execStreamTarget;
    if(firstByte: any): any;
}
export {};
//# sourceMappingURL=wire.d.ts.map