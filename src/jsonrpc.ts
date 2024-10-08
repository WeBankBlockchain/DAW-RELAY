import {
  formatJsonRpcError,
  formatJsonRpcResult,
  getError,
  isJsonRpcRequest,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcPayload,
  METHOD_NOT_FOUND,
  INVALID_REQUEST,
} from "@walletconnect/jsonrpc-utils";
import { Logger } from "pino";
import {
  RELAY_JSONRPC,
  RelayJsonRpc,
  parsePublishRequest,
  parseSubscribeRequest,
  parseUnsubscribeRequest,
} from "@walletconnect/relay-api";
import { generateChildLogger } from "@walletconnect/logger";

import { HttpService } from "./http";
import { Subscription } from "./types";
import { JSONRPC_CONTEXT, JSONRPC_EVENTS, SUBSCRIPTION_EVENTS, PUB_SUB_TOPIC, REDIS_EVENTS } from "./constants";
import { formatDate } from "./utils";

export class JsonRpcService {
  public context = JSONRPC_CONTEXT;

  constructor(public server: HttpService, public logger: Logger) {
    this.server = server;
    this.logger = generateChildLogger(logger, this.context);
    this.initialize();
  }

  public async onPayload(socketId: string, payload: JsonRpcPayload): Promise<void> {
    if (isJsonRpcRequest(payload)) {
      this.onRequest(socketId, payload);
    } else {
      this.onResponse(socketId, payload);
    }
  }

  public async onRequest(socketId: string, request: JsonRpcRequest): Promise<void> {
    try {
      this.logger.debug(`Incoming JSON-RPC Payload`);
      this.logger.debug({ type: "payload", direction: "incoming", payload: request, socketId });

      // https://specs.walletconnect.com/2.0/specs/servers/relay/relay-server-rpc
      switch (request.method) {
        case RELAY_JSONRPC.irn.publish:
        case RELAY_JSONRPC.waku.publish:
        case RELAY_JSONRPC.iridium.publish:
          await this.onPublishRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.PublishParams>,
          );
          break;
        case RELAY_JSONRPC.irn.batchPublish:
        case RELAY_JSONRPC.waku.batchPublish:
        case RELAY_JSONRPC.iridium.batchPublish:
          await this.onBatchPublishRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.BatchPublishParams>,
          );
          break;
        case RELAY_JSONRPC.irn.subscribe:
        case RELAY_JSONRPC.waku.subscribe:
        case RELAY_JSONRPC.iridium.subscribe:
          await this.onSubscribeRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.SubscribeParams>,
          );
          break;
        case RELAY_JSONRPC.irn.batchSubscribe:
        case RELAY_JSONRPC.waku.batchSubscribe:
        case RELAY_JSONRPC.iridium.batchSubscribe:
          await this.onBatchSubscribeRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.BatchSubscribeParams>,
          );
          break;
        case RELAY_JSONRPC.irn.subscription:
        case RELAY_JSONRPC.waku.subscription:
        case RELAY_JSONRPC.iridium.subscription:
          // subscription is server send to client
          this.server.ws.send(socketId, formatJsonRpcError(request.id, getError(INVALID_REQUEST)));
          break;
        case RELAY_JSONRPC.irn.unsubscribe:
        case RELAY_JSONRPC.waku.unsubscribe:
        case RELAY_JSONRPC.iridium.unsubscribe:
          await this.onUnsubscribeRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.UnsubscribeParams>,
          );
          break;
        case RELAY_JSONRPC.irn.batchUnsubscribe:
        case RELAY_JSONRPC.waku.batchUnsubscribe:
        case RELAY_JSONRPC.iridium.batchUnsubscribe:
          await this.onBatchUnsubscribeRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.BatchUnsubscribeParams>,
          );
          break;
        case RELAY_JSONRPC.irn.batchFetchMessages:
        case RELAY_JSONRPC.waku.batchFetchMessages:
        case RELAY_JSONRPC.iridium.batchFetchMessages:
          await this.onBatchFetchMessagesRequest(
            socketId,
            request as JsonRpcRequest<RelayJsonRpc.BatchFetchMessagesParams>,
          );
          break;
        default:
          this.server.ws.send(socketId, formatJsonRpcError(request.id, getError(METHOD_NOT_FOUND)));
          return;
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      this.server.ws.send(socketId, formatJsonRpcError(request.id, (e as any).message));
    }
  }

  public async onResponse(socketId: string, response: JsonRpcResponse): Promise<void> {
    this.logger.info(`Incoming JSON-RPC Payload`);
    this.logger.debug({ type: "payload", direction: "incoming", payload: response, socketId });
    await this.server.message.ackMessage(response.id);
  }

  // ---------- Private ----------------------------------------------- //

  private initialize(): void {
    this.registerEventListeners();
    this.logger.trace(`Initialized`);
  }

  private registerEventListeners(): void {
    this.server.events.once(REDIS_EVENTS.subscriber_connected, async () => {
      this.server.redis.on(
        PUB_SUB_TOPIC.messages.added,
        async ({ params, socketId }: { params: RelayJsonRpc.PublishParams; socketId: string }) => {
          await this.checkActiveSubscriptions(socketId, params);
        },
      );
      this.server.events.on(SUBSCRIPTION_EVENTS.added, async (subscription: Subscription) => {
        if (!subscription.legacy) {
          await this.checkCachedMessages(subscription);
        }
      });
    });
  }

  private async onPublishRequest(socketId: string, request: JsonRpcRequest) {
    const params = parsePublishRequest(request);
    const maxTTL = this.server.config.maxTTL;
    if (params.ttl > maxTTL) {
      const errorMessage = `requested ttl is above ${maxTTL} seconds`;
      this.logger.error(errorMessage);
      this.server.ws.send(
        socketId,
        formatJsonRpcError(request.id, `requested ttl is above ${maxTTL} seconds`),
      );
      return;
    }
    this.logger.debug(`Publish Request Received`);
    this.logger.trace({ type: "method", method: "onPublishRequest", socketId, params });
    await this.server.message.setMessage(params, socketId);
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, true));
    this.server.events.emit(JSONRPC_EVENTS.publish, params, socketId);
  }

  private async onBatchPublishRequest(socketId: string, request: JsonRpcRequest<RelayJsonRpc.BatchPublishParams>) {
    const publishParams = request.params as RelayJsonRpc.BatchPublishParams;
    for (const params of publishParams.messages) {
      const maxTTL = this.server.config.maxTTL;
      if (params.ttl > maxTTL) {
        const errorMessage = `requested ttl is above ${maxTTL} seconds`;
        this.logger.error(errorMessage);
        this.server.ws.send(
          socketId,
          formatJsonRpcError(request.id, `requested ttl is above ${maxTTL} seconds`),
        );
        return;
      }
      this.logger.debug(`BatchPublish Request Received`);
      this.logger.trace({ type: "method", method: "onBatchPublishRequest", socketId, params });
      await this.server.message.setMessage(params, socketId);
      this.server.events.emit(JSONRPC_EVENTS.publish, params, socketId);
    }
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, true));
  }

  private async onSubscribeRequest(socketId: string, request: JsonRpcRequest) {
    const params = parseSubscribeRequest(request);
    this.logger.debug(`Subscribe Request Received`);
    this.logger.trace({ type: "method", method: "onSubscribeRequest", socketId, params });

    const jsonrpcMethod =
      request.method === RELAY_JSONRPC.iridium.subscribe
        ? RELAY_JSONRPC.iridium.subscription.toString()
        : (request.method === RELAY_JSONRPC.waku.subscribe ? RELAY_JSONRPC.waku.subscription.toString() : RELAY_JSONRPC.irn.subscription.toString());

    const id = this.server.subscription.set({
      topic: params.topic,
      socketId,
      jsonrpcMethod,
    });
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, id));
    const subscription = { id, topic: params.topic, socketId };
    this.server.events.emit(JSONRPC_EVENTS.subscribe, subscription);
  }

  private async onBatchSubscribeRequest(socketId: string, request: JsonRpcRequest) {
    const params = request.params as RelayJsonRpc.BatchSubscribeParams;
    this.logger.debug(`BatchSubscribe Request Received`);
    this.logger.trace({ type: "method", method: "onBatchSubscribeRequest", socketId, params });
    var topicIDs: string[] = [];
    var topicToID = new Map();
    const jsonrpcMethod =
      request.method === RELAY_JSONRPC.iridium.subscribe
        ? RELAY_JSONRPC.iridium.subscription.toString()
        : (request.method === RELAY_JSONRPC.waku.subscribe ? RELAY_JSONRPC.waku.subscription.toString() : RELAY_JSONRPC.irn.subscription.toString());
    for (const topic of params.topics) {
      if (!topicToID.has(topic)) {
        const id = this.server.subscription.set({
          topic,
          socketId,
          jsonrpcMethod,
        });
        topicToID.set(topic, id);
        topicIDs.push(id);
        // const subscription = { id, topic, socketId };
        // this.server.events.emit(JSONRPC_EVENTS.subscribe, subscription);
      } else {
        topicIDs.push(topicToID.get(topic));
      }
    }
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, topicIDs));
  }

  private async onUnsubscribeRequest(socketId: string, request: JsonRpcRequest) {
    const params = parseUnsubscribeRequest(request);
    this.logger.debug(`Unsubscribe Request Received`);
    this.logger.trace({ type: "method", method: "onUnsubscribeRequest", socketId, params });
    this.server.subscription.remove(params.id);
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, true));
    this.server.events.emit(JSONRPC_EVENTS.unsubscribe, params.id);
  }

  private async onBatchUnsubscribeRequest(socketId: string, request: JsonRpcRequest) {
    const params = request.params as RelayJsonRpc.BatchUnsubscribeParams;
    for (const subscription of params.subscriptions) {
      this.logger.debug(`Unsubscribe Request Received`);
      this.logger.trace({ type: "method", method: "onBatchUnsubscribeRequest", socketId, subscription });
      this.server.subscription.remove(subscription.id);
      this.server.events.emit(JSONRPC_EVENTS.unsubscribe, subscription.id);
    }
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, true));
  }

  private async onFetchMessagesRequest(socketId: string, request: JsonRpcRequest) {
    // https://specs.walletconnect.com/2.0/specs/servers/relay/relay-server-rpc#fetch-messages
    const params = request.params as { topic: string };
    this.logger.debug(`Fetch Messages Request Received`);
    this.logger.trace({ type: "method", method: "onFetchMessagesRequest", socketId, params });
    const messages = await this.server.message.getMessages(params.topic);
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, { messages: messages, hashMore: false }));
  }

  private async onBatchFetchMessagesRequest(socketId: string, request: JsonRpcRequest<RelayJsonRpc.BatchFetchMessagesParams>) {
    // https://specs.walletconnect.com/2.0/specs/servers/relay/relay-server-rpc#batch-fetch-messages
    const params = request.params as RelayJsonRpc.BatchFetchMessagesParams;
    this.logger.debug(`Batch Fetch Messages Request Received`);
    const messages = await Promise.all(
      // make topics unique and get messages for each topic
      [...new Set(params.topics)].map(async (topic: string) => {
        return await this.server.message.getMessages(topic);
      }),
    );
    this.logger.trace({ type: "method", method: "onBatchFetchMessagesRequest", messageCount: messages.length, socketId, params });
    this.server.ws.send(socketId, formatJsonRpcResult(request.id, { messages: messages, hashMore: false }));
  }

  private async checkActiveSubscriptions(socketId: string, params: RelayJsonRpc.PublishParams) {
    this.logger.debug(`Checking Active subscriptions`);
    this.logger.trace({ type: "method", method: "checkActiveSubscriptions", socketId, params });
    const { topic, message } = params;
    const subscriptions = this.server.subscription.get(topic, socketId);
    this.logger.debug(`Found ${subscriptions.length} subscriptions`);
    this.logger.trace({ type: "method", method: "checkActiveSubscriptions", subscriptions });
    if (subscriptions.length) {
      await Promise.all(
        subscriptions.map(async (subscription: Subscription) => {
          await this.server.message.pushMessage(subscription, message);
        }),
      );
    }
  }

  private async checkCachedMessages(subscription: Subscription) {
    const { socketId } = subscription;
    const messages = await this.server.message.getMessages(subscription.topic);
    this.logger.debug(`Checking Cached Messages, Found ${messages.length} cached messages`);
    this.logger.trace({ type: "method", socketId, method: "checkCachedMessages", messages });
    if (messages && messages.length) {
      await Promise.all(
        messages.map(async (message: string) => {
          await this.server.message.pushMessage(subscription, message);
        }),
      );
    }
  }
}
