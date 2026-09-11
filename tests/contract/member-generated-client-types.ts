import type { paths } from "@lottify/contracts";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head";
type MemberPath = Extract<keyof paths, `/api/v1/member${string}`>;

type JsonBody<Response> = Response extends { content: infer Content }
  ? Content extends { "application/json": infer Body }
    ? Body
    : never
  : never;

type SuccessBody<Operation> = Operation extends { responses: infer Responses }
  ? 200 extends keyof Responses
    ? JsonBody<Responses[200]>
    : 201 extends keyof Responses
      ? JsonBody<Responses[201]>
      : 202 extends keyof Responses
        ? JsonBody<Responses[202]>
        : 203 extends keyof Responses
          ? JsonBody<Responses[203]>
          : 206 extends keyof Responses
            ? JsonBody<Responses[206]>
            : never
  : never;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsExactlyUnknown<T> = IsAny<T> extends true
  ? false
  : unknown extends T
    ? [keyof T] extends [never]
      ? true
      : false
    : false;

type UnknownMemberSuccessResponses = {
  [Path in MemberPath]: {
    [Method in Extract<keyof paths[Path], HttpMethod>]: IsExactlyUnknown<
      SuccessBody<NonNullable<paths[Path][Method]>>
    > extends true
      ? `${Uppercase<Method & string>} ${Path & string}`
      : never;
  }[Extract<keyof paths[Path], HttpMethod>];
}[MemberPath];

type AssertNever<T extends never> = T;
type AssertTrue<T extends true> = T;

/**
 * Ticket 10 / Item 8 guard: if a generated Member success response regresses to
 * top-level `unknown`, this exported alias stops `pnpm typecheck`.
 */
export type MemberGeneratedSuccessResponsesAreTyped = AssertNever<UnknownMemberSuccessResponses>;

type RecoveryVerification = SuccessBody<
  NonNullable<paths["/api/v1/member/auth/recovery/otp/verify"]["post"]>
>;

export type RecoveryVerificationHasRequiredEvidenceShape = AssertTrue<
  RecoveryVerification extends {
    purpose: "RECOVERY";
    verified: boolean;
    evidenceRef: string;
  }
    ? true
    : false
>;

export type RecoveryVerificationDoesNotAuthenticate = AssertNever<
  Extract<
    keyof RecoveryVerification,
    "accessToken" | "refreshToken" | "memberId" | "deviceId" | "sessionId"
  >
>;
