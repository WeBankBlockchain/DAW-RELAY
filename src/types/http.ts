import { RequestGenericInterface } from "fastify";
export interface HttpServiceConfig {
  logLevel: string;
  port: number;
  host: string;
  redis: {
    url: string;
    username?: string;
    password?: string;
  };
  maxTTL: number;
  gitHash: string;
  version: any;
  recordFormatter: string;
  logFileName: string | number;
  logFilePath: string;
  requiredParams: {
    projectId: boolean;
    clientId: boolean;
  };
  throttle: {
    messages: number;
    interval: number;
  };
  whiteListPublicKeys: { name: string, publicKey: string }[]
  validUrls: string[];
}

export interface PostSubscribeRequest extends RequestGenericInterface {
  Body: {
    topic: string;
    webhook: string;
  };
}

export interface GetAuthNonceRequest extends RequestGenericInterface {
  Querystring: {
    did: string;
  };
}

export interface GetWebsocketHandshakeRequest extends RequestGenericInterface {
  Querystring: {
    projectId: string;
    auth: string;
  };
}
