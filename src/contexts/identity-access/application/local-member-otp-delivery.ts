import { Injectable } from "@nestjs/common";
import type { MemberOtpDeliveryPort } from "./member-otp-delivery.port";

// Default delivery adapter used when no Notification provider is wired
// (Ticket 09 sequencing). In local/test the code must still be observable by
// the integration harness, so the plaintext is retained on an in-memory sink
// rather than relying on a real SMS gateway.
@Injectable()
export class LocalMemberOtpDelivery implements MemberOtpDeliveryPort {
  private readonly sink = new Map<string, string[]>();

  async deliver(input: { phone: string; purpose: string; code: string }): Promise<void> {
    const key = `${input.purpose}:${input.phone}`;
    const entries = this.sink.get(key) ?? [];
    entries.push(input.code);
    this.sink.set(key, entries);
  }

  lastCode(phone: string, purpose: string): string | undefined {
    const entries = this.sink.get(`${purpose}:${phone}`);
    return entries ? entries[entries.length - 1] : undefined;
  }

  clear(): void {
    this.sink.clear();
  }
}
