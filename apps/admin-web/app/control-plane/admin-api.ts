"use client";

import { randomUUID } from "../lib/random-uuid";

export class ApiFailure extends Error {
  constructor(
    public code: string,
    message: string,
    public correlationId?: string,
  ) {
    super(message);
  }
}

/**
 * Authorized Admin API client shared by the control-plane shell.
 * It keeps the access token in memory only, refreshes from the HttpOnly
 * refresh cookie, and attaches a stable Idempotency-Key for commands.
 */
export class AdminApi {
  private token: string | null = null;
  private refreshing: Promise<string> | null = null;
  private keys = new Map<string, string>();

  clear(): void {
    this.token = null;
    this.keys.clear();
  }

  async publicRequest<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/v1/admin/${path}`, {
      method: "POST",
      credentials: "include",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return this.read<T>(response);
  }

  async accept(token: string): Promise<void> {
    this.token = token;
  }

  private refresh(): Promise<string> {
    if (!this.refreshing) {
      this.refreshing = this.publicRequest<{ accessToken: string }>("auth/refresh")
        .then((result) => {
          this.token = result.accessToken;
          return result.accessToken;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  async request<T>(path: string, body?: unknown, command = false): Promise<T> {
    const identity = `${path}:${JSON.stringify(body ?? null)}`;
    if (command && !this.keys.has(identity)) {
      this.keys.set(identity, randomUUID());
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (command) headers["Idempotency-Key"] = this.keys.get(identity)!;
    const send = (token: string) =>
      fetch(`/api/v1/admin/${path}`, {
        method: body === undefined ? "GET" : "POST",
        credentials: "include",
        headers: { ...headers, Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    let response = await send(this.token ?? (await this.refresh()));
    if (response.status === 401) response = await send(await this.refresh());
    const result = await this.read<T>(response);
    if (command) this.keys.delete(identity);
    return result;
  }

  private async read<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const record = body as Record<string, unknown>;
      throw new ApiFailure(
        typeof record.code === "string"
          ? record.code
          : response.status === 401
            ? "SESSION_REQUIRED"
            : `HTTP_${response.status}`,
        typeof record.message === "string"
          ? record.message
          : "ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง",
        typeof record.correlationId === "string" ? record.correlationId : undefined,
      );
    }
    return body as T;
  }
}
