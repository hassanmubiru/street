// src/transports/rabbitmq/connection.ts
// AMQP 0-9-1 connection + single-channel manager over node:net. Implements the
// handshake, channel/exchange/queue declaration, publisher confirms, consumer
// delivery + ack/nack, heartbeats, and graceful close.

import { createConnection, type Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import {
  PROTOCOL_HEADER, FRAME_METHOD, FRAME_HEADER, FRAME_BODY, FRAME_HEARTBEAT,
  AmqpWriter, FrameDecoder, buildMethodFrame, buildHeaderFrame, buildBodyFrame,
  buildHeartbeat, readMethodHeader, type RawFrame,
} from './codec.js';

export interface AmqpConnectionOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
  heartbeatSeconds?: number;
  connectTimeoutMs?: number;
}

export interface DeliveredMessage {
  deliveryTag: bigint;
  redelivered: boolean;
  exchange: string;
  routingKey: string;
  body: Buffer;
}

const CH = 1; // single working channel

export class AmqpConnection extends EventEmitter {
  private socket: Socket | null = null;
  private readonly decoder = new FrameDecoder();
  private readonly opts: Required<AmqpConnectionOptions>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private closing = false;

  // class.method → resolver for synchronous server replies
  private readonly waiters = new Map<string, (r: { reader: import('./codec.js').AmqpReader }) => void>();
  // publisher confirms: delivery-tag → resolver
  private nextPublishTag = 1n;
  private readonly confirmWaiters = new Map<string, () => void>();
  private confirmEnabled = false;

  // consumer assembly state
  private pendingDelivery: { msg: Omit<DeliveredMessage, 'body'>; bodySize: number; chunks: Buffer[] } | null = null;
  private deliverHandler: ((msg: DeliveredMessage) => void) | null = null;

  constructor(opts: AmqpConnectionOptions = {}) {
    super();
    this.opts = {
      host: opts.host ?? '127.0.0.1',
      port: opts.port ?? 5672,
      username: opts.username ?? 'guest',
      password: opts.password ?? 'guest',
      vhost: opts.vhost ?? '/',
      heartbeatSeconds: opts.heartbeatSeconds ?? 60,
      connectTimeoutMs: opts.connectTimeoutMs ?? 10_000,
    };
  }

  private _key(classId: number, methodId: number): string { return `${classId}.${methodId}`; }

  private _send(frame: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new Error('AMQP socket not connected');
    this.socket.write(frame);
  }

  private _rpc(sendFrame: Buffer, expectClass: number, expectMethod: number): Promise<{ reader: import('./codec.js').AmqpReader }> {
    return new Promise((resolve) => {
      this.waiters.set(this._key(expectClass, expectMethod), resolve);
      this._send(sendFrame);
    });
  }
