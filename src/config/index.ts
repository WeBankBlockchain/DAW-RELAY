import { SERVER_LOGGER, REDIS_DEFAULT_MAXTTL } from "../constants";
import { HttpServiceConfig } from "../types";

const path = require("path");
const fs = require("fs");
const dotEnv = require("dotenv");

const appDirectory = fs.realpathSync(process.cwd());
const resolveApp = (relativePath) => path.resolve(appDirectory, relativePath);
const pathsDotenv = resolveApp(".env");
const pathsEnv = resolveApp("env");
dotEnv.config({ path: `${pathsEnv}` })  // 加载env
dotEnv.config({ path: `${pathsDotenv}` })  // 加载.env

const gitHash = process.env.GITHASH || "0000000";
const version = require("../../package.json").version || "0.0.0";
const logger = (process.env.LOG_LEVEL || "info").toLowerCase();

if (SERVER_LOGGER.levels.indexOf(logger) === -1) {
  throw Error(
    `Wrong log level used: ${process.env.LOG_LEVEL}. Valid levels are: ${SERVER_LOGGER.levels}`,
  );
}

export const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
export const host = process.env.HOST || `0.0.0.0`;

const logFileName = process.env.LOG_FILE_NAME || 1;
const logFilePath = process.env.LOG_FILE_PATH || "./logs";
const maxTTL: number = process.env.REDIS_MAXTTL
  ? parseInt(process.env.REDIS_MAXTTL, 10)
  : REDIS_DEFAULT_MAXTTL;
const redis = {
  url: process.env.REDIS_URL || `redis://localhost:6379/0`,
  username: process.env.REDIS_USERNAME || undefined,
  password: process.env.REDIS_PASSWORD || undefined,
};

const whiteListPublicKeys = process.env.WHITE_LIST_PUBLIC_KEYS ? JSON.parse(process.env.WHITE_LIST_PUBLIC_KEYS.replace(/\\/g, "")) : [];
const requiredParams = {
  clientId: true, // always require
  projectId: !!process.env.REQUIRE_PROJECT_ID || false,
};

const throttle = {
  messages: process.env.MAX_MESSAGES ? parseInt(process.env.MAX_MESSAGES) : 15 * 60, // max socket messages allowed per interval
  interval: process.env.THROTTLE_INTERVAL ? parseInt(process.env.THROTTLE_INTERVAL) : 60, // in seconds
};
const validUrls = process.env.VALID_URLS ? process.env.VALID_URLS.split(",") : [];
const config: HttpServiceConfig = {
  logLevel: logger,
  port,
  host,
  redis,
  maxTTL,
  gitHash,
  version,
  recordFormatter: process.env.RECORD_FORMATTER || "json",
  logFileName,
  logFilePath,
  requiredParams,
  throttle,
  whiteListPublicKeys,
  validUrls,
};
console.log(config)

export default config;
