import { NextFunction, Request, Response } from "express";
import { env } from "@/config/env";
import { logger } from "@/config/logger";

const useColor = !env.isProduction && Boolean(process.stdout.isTTY);

const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
} as const;

const statusColor = (code: number): string => {
  if (code >= 500) return ansi.red;
  if (code >= 400) return ansi.yellow;
  if (code >= 300) return ansi.cyan;
  return ansi.green;
};

const paint = (color: string, text: string): string =>
  useColor ? `${color}${text}${ansi.reset}` : text;

/** Matches pino-pretty `SYS:standard` style used by the app logger. */
const formatTimestamp = (date = new Date()): string => {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.` +
    `${pad(date.getMilliseconds(), 3)} ${off}`
  );
};

const formatAccessLine = (
  statusCode: number,
  method: string,
  url: string,
  ms: number,
): string => {
  const status = paint(`${ansi.bold}${statusColor(statusCode)}`, String(statusCode));
  const verb = paint(ansi.magenta, method);
  const path = paint(ansi.dim, url);
  const time = paint(statusColor(statusCode), `${ms}ms`);
  return `${status} | ${verb}: ${path} | ${time}`;
};

const writeAccessLine = (line: string): void => {
  const stamp = paint(ansi.gray, `[${formatTimestamp()}]`);
  process.stdout.write(`${stamp} ${line}\n`);
};

/** Compact HTTP access log: status | METHOD: url | duration. */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const started = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
    const url = req.originalUrl || req.url;
    const line = formatAccessLine(res.statusCode, req.method, url, ms);
    const err = res.locals.error as unknown;
    const failed = res.statusCode >= 400 || err != null;

    if (!failed) {
      logger.info("request completed");
      writeAccessLine(line);
      return;
    }

    logger.info("request incompleted");
    writeAccessLine(line);
    if (res.statusCode >= 500 && err != null) {
      logger.error({ err }, "request error");
    }
  });

  next();
};
