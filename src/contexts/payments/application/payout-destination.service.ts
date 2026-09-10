import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  PAYOUT_DESTINATION_VERIFICATION_ADAPTER,
  type PayoutDestinationVerificationAdapter,
} from "./payout-destination-verification.adapter";
import {
  PAYOUT_DESTINATION_REPOSITORY,
  type PayoutDestinationRepository,
} from "../domain/payout-destination.repository";
import {
  PayoutDestinationError,
  maskAccountNumber,
  payoutDestinationDigest,
  validatePayoutDestinationInput,
  type PayoutDestination,
  type PayoutDestinationType,
} from "../domain/payout-destination";

export interface AddPayoutDestinationCommand {
  type: PayoutDestinationType;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
}

@Injectable()
export class PayoutDestinationService {
  constructor(
    @Inject(PAYOUT_DESTINATION_REPOSITORY)
    private readonly destinations: PayoutDestinationRepository,
    @Inject(PAYOUT_DESTINATION_VERIFICATION_ADAPTER)
    private readonly verification: PayoutDestinationVerificationAdapter,
  ) {}

  /**
   * Registers a Member-linked Payout Destination in `PENDING`. The raw account
   * reference is never persisted or returned: only an opaque digest (duplicate
   * and sharing detection) plus the masked display value. Sharing one
   * destination across Members is blocked by default policy (Ticket 06).
   */
  async addDestination(
    memberId: string,
    command: AddPayoutDestinationCommand,
  ): Promise<PayoutDestination> {
    validatePayoutDestinationInput({
      type: command.type,
      bankCode: command.bankCode,
      accountNumber: command.accountNumber,
      accountHolderName: command.accountHolderName,
      currency: "THB",
    });

    const accountDigest = payoutDestinationDigest({
      type: command.type,
      bankCode: command.bankCode,
      accountNumber: command.accountNumber,
    });
    const existing = await this.destinations.findByAccountDigest(accountDigest);
    if (existing.some((destination) => destination.memberId !== memberId)) {
      throw new PayoutDestinationError(
        "SHARED_DESTINATION_BLOCKED",
        "This Payout Destination is already linked to another Member",
      );
    }

    const created = await this.destinations.create({
      id: randomUUID(),
      memberId,
      type: command.type,
      bankCode: command.bankCode.trim().toUpperCase(),
      accountNumberMasked: maskAccountNumber(command.accountNumber),
      accountDigest,
      accountHolderName: command.accountHolderName.trim(),
      currency: "THB",
    });
    if (!created) {
      throw new PayoutDestinationError(
        "DUPLICATE",
        "This Payout Destination is already registered",
      );
    }
    return created;
  }

  listDestinations(memberId: string): Promise<readonly PayoutDestination[]> {
    return this.destinations.listByMember(memberId);
  }

  async getDestination(memberId: string, destinationId: string): Promise<PayoutDestination> {
    return this.requireOwnedDestination(memberId, destinationId);
  }

  /**
   * Requests an independent verification for the destination. Verification is
   * separate from Member/KYC status and only the normalized outcome plus an
   * opaque evidence reference crosses the seam.
   */
  async verifyDestination(
    memberId: string,
    destinationId: string,
    correlationId: string,
  ): Promise<PayoutDestination> {
    const destination = await this.requireOwnedDestination(memberId, destinationId);
    if (destination.disabledAt) {
      throw new PayoutDestinationError(
        "STATE_CONFLICT",
        "A disabled Payout Destination cannot be verified",
      );
    }
    if (destination.status === "VERIFIED") {
      return destination;
    }

    const result = await this.verification.verify({
      destinationId: destination.id,
      memberId,
      type: destination.type,
      bankCode: destination.bankCode,
      accountDigest: destination.accountDigest,
      accountHolderName: destination.accountHolderName,
      requestAttemptId: randomUUID(),
      correlationId,
    });
    if (result.outcome === "PENDING") {
      return destination;
    }

    const resolved = await this.destinations.resolveVerification(destination.id, {
      status: result.outcome,
      expectedVersion: destination.version,
      verificationEvidenceRef: result.evidenceRef,
      verifiedAt: result.outcome === "VERIFIED" ? new Date() : null,
    });
    if (!resolved) {
      throw new PayoutDestinationError(
        "VERSION_CONFLICT",
        "Payout Destination changed while its verification was being applied",
      );
    }
    return resolved;
  }

  private async requireOwnedDestination(
    memberId: string,
    destinationId: string,
  ): Promise<PayoutDestination> {
    const destination = await this.destinations.findById(destinationId);
    if (!destination || destination.memberId !== memberId) {
      throw new PayoutDestinationError("NOT_FOUND", "Payout Destination not found");
    }
    return destination;
  }
}
