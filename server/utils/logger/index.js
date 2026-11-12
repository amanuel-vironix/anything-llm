const util = require("util");
const winston = require("winston");
const { scrubSecrets } = require("../audit/sanitize");

/**
 * Joins console arguments into one line, redacts secrets (tokens, keys,
 * passwords, credentials in URLs; PLAN-audit-logging-and-compliance.md 3.4)
 * and prefixes the request id when the line is written during a request, so
 * application logs and audit rows can be matched.
 * @param {any[]} args
 * @returns {string}
 */
function formatLogArgs(args) {
  const text = args
    .map((arg) => {
      if (arg instanceof Error) return arg.stack;
      if (arg !== null && typeof arg === "object") {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return arg;
    })
    .join(" ");
  const requestId = require("../audit/context").currentContext()?.requestId;
  return `${requestId ? `[req:${requestId.slice(0, 8)}] ` : ""}${scrubSecrets(text)}`;
}

/**
 * Outside production the console stays the console, but its output is still
 * scrubbed of secrets.
 */
function scrubConsole() {
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method];
    if (typeof original !== "function" || original.__scrubbed) continue;
    // util.format keeps the console's usual rendering of objects in dev.
    const scrubbed = function (...args) {
      return original.call(console, scrubSecrets(util.format(...args)));
    };
    scrubbed.__scrubbed = true;
    console[method] = scrubbed;
  }
}

class Logger {
  logger = console;
  static _instance;
  constructor() {
    if (Logger._instance) return Logger._instance;
    this.logger =
      process.env.NODE_ENV === "production" ? this.getWinstonLogger() : console;
    if (process.env.NODE_ENV !== "production") scrubConsole();
    Logger._instance = this;
  }

  getWinstonLogger() {
    const logger = winston.createLogger({
      level: "info",
      defaultMeta: { service: "backend" },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(
              ({ level, message, service, origin = "" }) => {
                return `\x1b[36m[${service}]\x1b[0m${origin ? `\x1b[33m[${origin}]\x1b[0m` : ""} ${level}: ${message}`;
              }
            )
          ),
        }),
      ],
    });

    const formatArgs = (args) => formatLogArgs(args);

    console.log = function (...args) {
      logger.info(formatArgs(args));
    };
    console.error = function (...args) {
      logger.error(formatArgs(args));
    };
    console.info = function (...args) {
      logger.warn(formatArgs(args));
    };
    return logger;
  }
}

/**
 * Sets and overrides Console methods for logging when called.
 * This is a singleton method and will not create multiple loggers.
 * @returns {winston.Logger | console} - instantiated logger interface.
 */
function setLogger() {
  return new Logger().logger;
}
module.exports = setLogger;
module.exports.formatLogArgs = formatLogArgs;
module.exports.scrubConsole = scrubConsole;
