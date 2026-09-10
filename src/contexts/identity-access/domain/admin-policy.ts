import {
  ADMIN_ROLES,
  type AdminCapability,
  type AdminRole,
} from "./admin-auth.repository";

const ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  SUPER_ADMIN: [
    "accounting-period.read",
    "accounting-period.create-custom",
    "accounting-period.submit",
    "accounting-period.approve",
    "accounting-period.cancel",
    "accounting-period.close",
    "lottery-configuration.read",
    "lottery-configuration.create",
    "lottery-configuration.submit",
    "lottery-configuration.approve",
    "lottery-draw.read",
    "lottery-draw.manage",
  ],
  ADMIN: [
    "accounting-period.read",
    "accounting-period.create-custom",
    "accounting-period.submit",
    "accounting-period.approve",
    "accounting-period.cancel",
    "accounting-period.close",
    "lottery-configuration.read",
    "lottery-configuration.create",
    "lottery-configuration.submit",
    "lottery-configuration.approve",
    "lottery-draw.read",
    "lottery-draw.manage",
  ],
  AUDITOR: ["accounting-period.read", "lottery-configuration.read", "lottery-draw.read"],
};

export function parseAdminRole(value: string): AdminRole | null {
  return ADMIN_ROLES.find((role) => role === value) ?? null;
}

export function capabilitiesForRole(role: AdminRole): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role];
}
