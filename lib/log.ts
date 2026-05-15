import pino from 'pino';
import { env } from './env';

const isTest = env.NODE_ENV === 'test';
const isDev = env.NODE_ENV === 'development';
const wantsPretty = isDev && env.LOG_FORMAT !== 'json';

/**
 * Structured logger. Always emit JSON in production for log aggregation;
 * pretty-print only when running locally. Silent during vitest runs unless
 * `LOG_LEVEL` is set explicitly.
 *
 * Convention: pass a context object first, message second:
 *
 *   log.info({ organizationId, threadId }, 'inbox.thread.assigned');
 *   log.error({ err, organizationId }, 'inbox.reply.failed');
 *
 * Do not interpolate values into the message string. Structured fields make
 * logs queryable later.
 */
export const log = pino({
  level: env.LOG_LEVEL ?? (isTest ? 'silent' : isDev ? 'debug' : 'info'),
  base: { service: 'blacknel' },
  ...(wantsPretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});

export type Logger = typeof log;
