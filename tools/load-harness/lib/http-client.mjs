// Minimal keep-alive HTTP client for the load harness (node stdlib only).
//
// Deliberately not using fetch/undici: we need connection-pool control,
// per-request wall-clock timing that starts before the socket write, and a
// co-located-client measurement that we can describe honestly in the report.

import http from "node:http";
import https from "node:https";

export class HttpClient {
  constructor({ baseUrl, maxSockets = 512, timeoutMs = 30_000, agentOptions = {} }) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Unsupported base URL protocol: ${url.protocol}`);
    }
    this.baseUrl = url;
    this.timeoutMs = timeoutMs;
    const Agent = url.protocol === "https:" ? https.Agent : http.Agent;
    this.agent = new Agent({
      keepAlive: true,
      maxSockets,
      maxFreeSockets: Math.min(maxSockets, 256),
      scheduling: "lifo",
      ...agentOptions,
    });
    this.requestImpl = url.protocol === "https:" ? https.request : http.request;
  }

  /**
   * @returns {Promise<{status:number, ms:number, body:string, error:string|null}>}
   */
  request({ method = "GET", path, headers = {}, body = null, timeoutMs = this.timeoutMs }) {
    const startedAt = process.hrtime.bigint();
    return new Promise((resolve) => {
      const finish = (status, payload, error) => {
        const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        resolve({ status, ms: elapsedMs, body: payload, error: error ?? null });
      };
      const request = this.requestImpl(
        {
          protocol: this.baseUrl.protocol,
          hostname: this.baseUrl.hostname,
          port: this.baseUrl.port || (this.baseUrl.protocol === "https:" ? 443 : 80),
          method,
          path,
          headers,
          agent: this.agent,
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => finish(response.statusCode ?? 0, Buffer.concat(chunks).toString("utf8"), null));
          response.on("error", (error) => finish(0, "", `response:${error.message}`));
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`timeout after ${timeoutMs} ms`));
      });
      request.on("error", (error) => finish(0, "", `request:${error.message}`));
      if (body !== null) request.write(body);
      request.end();
    });
  }

  close() {
    this.agent.destroy();
  }
}

export function jsonHeaders(token, extra = {}) {
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fixed-rate pacing loop: runs `task(index, cycle)` at `targetRps` across `workers`
 * concurrent executors until `durationSeconds` elapse. Returns when the window closes.
 */
export async function pacedWorkers({ workers, targetRps, durationSeconds, task, deadline }) {
  const perWorkerRps = targetRps / Math.max(workers, 1);
  const intervalMs = perWorkerRps > 0 ? 1000 / perWorkerRps : Infinity;
  const endAt = deadline ?? Date.now() + durationSeconds * 1000;
  let cycle = 0;
  const runner = async (workerIndex) => {
    let nextAt = Date.now();
    while (Date.now() < endAt) {
      const cycleIndex = cycle++;
      await task(cycleIndex, workerIndex);
      nextAt += intervalMs;
      const waitMs = nextAt - Date.now();
      if (waitMs > 0) await sleep(waitMs);
      else nextAt = Date.now();
    }
  };
  await Promise.all(Array.from({ length: workers }, (_, index) => runner(index)));
}
