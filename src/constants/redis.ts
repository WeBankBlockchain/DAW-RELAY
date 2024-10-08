import { ONE_DAY } from "@walletconnect/time";
import { MESSAGE_EVENTS } from "./message";

export const REDIS_CONTEXT = "redis";
export const REDIS_NOTIFICATION_MAX_SIZE = 10;
export const REDIS_DEFAULT_MAXTTL = ONE_DAY;
export const PUB_SUB_TOPIC = {
  messages: {
    ...MESSAGE_EVENTS,
  },
};

export const REDIS_EVENTS = {
  client_connected: "client_connected",
  subscriber_connected: "subscriber_connected",
  publisher_connected: "publisher_connected",
};
