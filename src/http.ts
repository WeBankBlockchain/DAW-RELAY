import { EventEmitter } from "events";
import fastify, { FastifyInstance, FastifyRequest, FastifyReply, type FastifyBaseLogger } from "fastify";
import helmet from "@fastify/helmet";
import ws from "@fastify/websocket";
import pino, { Logger } from "pino";
import { getDefaultLoggerOptions, generateChildLogger } from "@walletconnect/logger";
import client from "prom-client";

import { verifyJWT, decodeJWT, decodeIss, IridiumJWTSigned } from "@walletconnect/relay-auth";
import { getAuthFromRequest, assertType, HttpError } from "./utils";
import { RedisService } from "./redis";
import { WebSocketService } from "./ws";
import { NotificationService } from "./notification";
import { HttpServiceConfig, PostSubscribeRequest, GetWebsocketHandshakeRequest } from "./types";
import {
  METRICS_DURACTION_BUCKETS,
  METRICS_PREFIX,
  SERVER_BEAT_INTERVAL,
  SERVER_CONTEXT,
  SERVER_EVENTS,
} from "./constants";
import { SubscriptionService } from "./subscription";
import { MessageService } from "./message";
import { RsaDecryptFromHex } from './config'
import { Buffer } from 'node:buffer';
import { set } from "core-js/core/dict";
import { Socket } from "dgram";
const rfs = require('rotating-file-stream');

import { requestContext } from '@fastify/request-context'
const { fastifyRequestContextPlugin } = require('@fastify/request-context')

declare module '@fastify/request-context' {
  interface RequestContextData {
    socketOwner: string
  }
}

export class HttpService {
  public events = new EventEmitter();

  public app: FastifyInstance;
  public logger: Logger;
  public redis: RedisService;
  public ws: WebSocketService;
  public message: MessageService;
  public subscription: SubscriptionService;
  public notification: NotificationService;
  public context = SERVER_CONTEXT;
  public metrics;

  constructor(public config: HttpServiceConfig) {
    let conf = getDefaultLoggerOptions({ level: config.logLevel });
    let colorize = true;
    if (typeof config.logFileName === "string") {
      colorize = false;
      // target = "pino/file";
    }
    const pad = num => (num > 9 ? "" : "0") + num;
    const destinationPath = config.logFilePath + '/';
    const generator = (time, index) => {
      if (!time) return config.logFileName + '.log';
      var month = time.getFullYear() + "" + pad(time.getMonth() + 1);
      var day = pad(time.getDate());
      var hour = pad(time.getHours());
      var minute = pad(time.getMinutes());
      return `${config.logFileName}-${month}${day}-${hour}${minute}-${index}.log.gz`;
    };
    let stream = rfs.createStream(generator, {
      size: '512M', // 每个日志文件的最大大小
      interval: '1d', // 每天轮转一次
      compress: 'gzip', // 压缩旧日志文件
      path: destinationPath, // 日志文件存放路径
    });
    conf = Object.assign(conf, {
      // transport: {
      //   // target: "pino-pretty",
      //   // options: {
      //   //   colorize: colorize,
      //   //   translateTime: "SYS:standard", // convert timestamp to local time
      //   //   singleLine: true,
      //   //   destination: destination,
      //   //   ignore: "hostname",
      //   //   mkdir: true,
      //   // },
      // },
      // timestamp: pino.stdTimeFunctions.isoTime,
      prettyPrint: {
        colorize: colorize,
        translateTime: 'SYS:standard',
        singleLine: true,
        ignore: 'hostname,pid',
      }
    });
    conf.formatters = {
      level: (label) => {
        return { level: label.toUpperCase() };
      },
      bindings: () => {
        return {};
      }
    }
    const logger = colorize ? pino(conf) : pino(conf, stream);

    logger.info(`config: ${JSON.stringify(config)}`)
    this.config = config;
    this.app = fastify({
      logger: logger as FastifyBaseLogger,
      // https:{
      // key: fs.readFileSync(path.join(__dirname, 'file.key')),
      // cert: fs.readFileSync(path.join(__dirname, 'file.cert'))
      // }
    });
    if (this.config.redis.password !== undefined) {
      this.config.redis.password = RsaDecryptFromHex(this.config.redis.password);
    }
    this.logger = generateChildLogger(logger, this.context);
    this.metrics = this.setMetrics();
    this.ws = new WebSocketService(this, this.logger);
    this.redis = new RedisService(this, this.logger);
    this.message = new MessageService(this, this.logger);
    this.subscription = new SubscriptionService(this, this.logger);
    this.notification = new NotificationService(this, this.logger);

    this.initialize();
  }

  public on(event: string, listener: any): void {
    this.events.on(event, listener);
  }

  public once(event: string, listener: any): void {
    this.events.once(event, listener);
  }

  public off(event: string, listener: any): void {
    this.events.off(event, listener);
  }

  public removeListener(event: string, listener: any): void {
    this.events.removeListener(event, listener);
  }

  // ---------- Private ----------------------------------------------- //

  private initialize(): void {
    this.logger.trace(`Initialized`);
    this.registerApi();
    this.setBeatInterval();
  }

  public async validateProjectId(
    req: FastifyRequest<GetWebsocketHandshakeRequest>,
    res: FastifyReply,
  ) {
    try {
      if (this.config.requiredParams.projectId) {
        assertType(req, "query", "object");
        assertType(req.query, "projectId");
        // TODO: actually validate the ID when Cerbrus is available
      }
      return true;
    } catch (e) {
      this.logger.info(`validateProjectId failed: ${(e as Error).message}`);
      res
        .status((e as HttpError).statusCode)
        .send({ message: `Error: ${(e as HttpError).message}` });
      req.socket.destroy();
      return false;
    }
  }

  public async validateAuth(req: FastifyRequest<GetWebsocketHandshakeRequest>, res: FastifyReply) {
    requestContext.set('socketOwner', 'Unknown');
    try {
      const jwt = getAuthFromRequest(req);
      if (typeof jwt === "undefined") {
        this.logger.trace(`jwt is undefined, request ip is ${req.ip}`);
        throw new HttpError("jwt not found", 401);
      }
      const decoded = decodeJWT(jwt);
      if (!decoded) {
        this.logger.debug(`jwt is not valid`);
        throw new HttpError("decode jwt failed", 401);
      }
      const publicKey = decodeIss(decoded.payload.iss);
      let publicKeyHex = Buffer.from(publicKey).toString('hex').toLowerCase();
      // check public key is in whitelist
      if (this.config.whiteListPublicKeys.length > 0) {
        let inWhiteList = false;
        for (const obj of this.config.whiteListPublicKeys) {
          if (publicKeyHex === obj.publicKey.toLowerCase()) {
            this.logger.info(`public key ${publicKeyHex} is in whitelist, name is ${obj.name}`);
            inWhiteList = true;
            requestContext.set('socketOwner', obj.name);
          }
        }
        if (!inWhiteList) {
          this.logger.info(`public key ${publicKeyHex} is not in whitelist`);
          throw new HttpError(`public key is not in whitelist`, 401);
        }
      }
      if (this.config.validUrls.length > 0) {
        // check audience is correct
        let validUrl = false;
        for (const url of this.config.validUrls) {
          if (decoded.payload.aud === url) {
            validUrl = true;
            break;
          }
        }
        if (!validUrl) {
          this.logger.debug(`jwt audience is not correct, expected ${this.config.validUrls} but got ${decoded.payload.aud}`);
          throw new HttpError(`jwt audience is not correct`, 401);
        }
      }
      // socketOwner = this.checkJWT(decoded);
      if (requestContext.get('socketOwner') === 'Unknown') {
        throw new HttpError("jwt public key is not in whitelist", 401);
      }

      if (!await verifyJWT(jwt)) {
        throw new HttpError("verify jwt failed", 401);
      }
      let ttl = decoded.payload.exp - decoded.payload.iat;
      if (ttl <= 0) {
        throw new HttpError("JWT expired", 401);
      }
      // check if ttl is within the range, >0 and < 1 day
      if (ttl > 86400) {
        throw new HttpError("JWT ttl is too long, should less than 1 day", 401);
      }
      // set jwt expired for the connection, if expired, use setTimout to close the connection
      setTimeout(() => {
        const connection = req.socket;
        const remoteAddress = req.ip;
        if (connection.destroyed) {
          return;
        }
        this.logger.info(`jwt expired, close the connection, remoteAddress: ${remoteAddress}`);
        connection.destroy();
      }, ttl * 1000);
    } catch (e) {
      this.logger.info(`validateAuth failed: ${(e as Error).message}`);
      res
        .status(401)
        .send({ message: `Error: ${(e as HttpError).message}` });
      req.socket.destroy();
      // throw e;
    }
  }

  // private checkJWT(decoded: IridiumJWTSigned): boolean {
  //   const publicKey = decodeIss(decoded.payload.iss);
  //   let publicKeyHex = Buffer.from(publicKey).toString('hex');
  //   // check public key is in whitelist
  //   if (this.config.whiteListPublicKeys.length > 0) {
  //     let inWhiteList = false;
  //     for (const obj of this.config.whiteListPublicKeys) {
  //       if (publicKeyHex === obj.publicKey) {
  //         this.logger.info(`public key is in whitelist, name is ${obj.name}`);
  //         inWhiteList = true;
  //       }
  //     }
  //     if (!inWhiteList) {
  //       this.logger.info(`public key ${publicKeyHex} is not in whitelist`);
  //       return false;
  //     }
  //   }
  //   if (this.config.validUrls.length > 0) {
  //     // check audience is correct
  //     let validUrl = false;
  //     for (const url of this.config.validUrls) {
  //       if (decoded.payload.aud === url) {
  //         validUrl = true;
  //       }
  //     }
  //     if (!validUrl) {
  //       this.logger.debug(`jwt audience is not correct, expected ${this.config.validUrls} but got ${decoded.payload.aud}`);
  //       return false;
  //     }
  //   }
  //   return true;
  // }

  private registerApi() {
    this.app.register(helmet);
    this.app.register(ws);
    this.app.register(fastifyRequestContextPlugin, {
      hook: 'preValidation',
    });
    this.app.addHook(
      "preValidation",
      async (request: FastifyRequest<GetWebsocketHandshakeRequest>, reply: FastifyReply) => {
        this.logger.trace(`preValidation url: ${request.raw.url}, routerPath: ${request.routeOptions.url}`);
        if (request.routeOptions.url !== "/") return;
        var res = await this.validateProjectId(request, reply);
        if (res === false) {
          return res;
        }
        await this.validateAuth(request, reply);
        return res;
      },
    );
    const server = this; //eslint-disable-line
    this.app.register(async function (fastify) {
      server.ws.websocketHandler(fastify);
    });

    // this.app.get("/health", (_, res) => {
    //   res.status(204).send();
    // });

    this.app.get("/hello", (_, res) => {
      this.metrics.hello.inc();
      res
        .status(200)
        .send(`Hello World, this is Relay Server v${this.config.version}@${this.config.gitHash}`);
    });

    // this.app.get("/metrics", (_, res) => {
    //   res.headers({ "Content-Type": this.metrics.register.contentType });
    //   this.metrics.register.metrics().then((result) => {
    //     res.status(200).send(result);
    //   });
    // });

    // this.app.post<PostSubscribeRequest>("/subscribe", async (req, res) => {
    //   try {
    //     assertType(req, "body", "object");
    //     assertType(req.body, "topic");
    //     assertType(req.body, "webhook");

    //     await this.notification.register(req.body.topic, req.body.webhook);

    //     res.status(200).send({ success: true });
    //   } catch (e) {
    //     res
    //       .status((e as HttpError).statusCode)
    //       .send({ message: `Error: ${(e as HttpError).message}` });
    //   }
    // });
  }

  private setMetrics() {
    const register = new client.Registry();

    client.collectDefaultMetrics({
      prefix: METRICS_PREFIX,
      register,
      gcDurationBuckets: METRICS_DURACTION_BUCKETS,
    });
    const metrics = {
      register,
      hello: new client.Counter({
        registers: [register],
        name: `${this.context}_hello_counter`,
        help: "shows how much the /hello has been called",
      }),
    };
    return metrics;
  }

  private setBeatInterval() {
    setInterval(() => this.events.emit(SERVER_EVENTS.beat), SERVER_BEAT_INTERVAL);
  }
}
