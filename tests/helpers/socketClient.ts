/**
 * Minimal Socket.IO v4 client over Node's built-in WebSocket, so realtime
 * tests can talk to a real server without extra dependencies.
 * Protocol: engine.io "0" open, "2"/"3" ping/pong; socket.io "40" connect,
 * "41" disconnect, "42" event, "44" connect error.
 */
export interface TestSocket {
  events: Array<[string, unknown]>;
  /** Resolves with the server's connect ack, rejects with the connect_error message. */
  connected: Promise<void>;
  /** Resolves when the server disconnects this namespace socket ("41"). */
  serverDisconnected: Promise<void>;
  emit: (event: string, payload?: unknown) => void;
  /** Resolves with the payload once `count` events named `event` have arrived (including earlier ones). */
  waitFor: (event: string, count?: number, timeoutMs?: number) => Promise<unknown>;
  close: () => void;
}

export const connectTestSocket = (port: number, token?: string): TestSocket => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
  const events: Array<[string, unknown]> = [];
  const waiters: Array<{ event: string; count: number; resolve: (payload: unknown) => void }> =
    [];
  const received = (event: string) => events.filter(([name]) => name === event);
  const flushWaiters = () => {
    waiters.slice().forEach((waiter) => {
      const matches = received(waiter.event);
      if (matches.length < waiter.count) return;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(matches[waiter.count - 1][1]);
    });
  };

  let resolveConnected!: () => void;
  let rejectConnected!: (error: Error) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });
  let resolveDisconnected!: () => void;
  const serverDisconnected = new Promise<void>((resolve) => {
    resolveDisconnected = resolve;
  });

  ws.addEventListener("message", (message) => {
    const data = String(message.data);
    if (data.startsWith("0")) {
      ws.send(`40${JSON.stringify(token ? { token } : {})}`);
    } else if (data === "2") {
      ws.send("3");
    } else if (data.startsWith("40")) {
      resolveConnected();
    } else if (data.startsWith("44")) {
      rejectConnected(new Error(JSON.parse(data.slice(2)).message));
    } else if (data.startsWith("41")) {
      resolveDisconnected();
    } else if (data.startsWith("42")) {
      events.push(JSON.parse(data.slice(2)) as [string, unknown]);
      flushWaiters();
    }
  });
  ws.addEventListener("error", () => rejectConnected(new Error("socket error")));

  return {
    events,
    connected,
    serverDisconnected,
    emit: (event, payload) => ws.send(`42${JSON.stringify([event, payload])}`),
    waitFor: (event, count = 1, timeoutMs = 1000) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Timed out waiting for "${event}" #${count}`)),
          timeoutMs,
        );
        waiters.push({
          event,
          count,
          resolve: (payload) => {
            clearTimeout(timer);
            resolve(payload);
          },
        });
        flushWaiters();
      }),
    close: () => ws.close(),
  };
};

/** Lets in-flight socket frames arrive before asserting that nothing did. */
export const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));
