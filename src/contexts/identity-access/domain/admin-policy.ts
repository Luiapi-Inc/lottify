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
  ],
  ADMIN: [
    "accounting-period.read",
    "accounting-period.create-custom",
    "accounting-period.submit",
    "accounting-period.approve",
    "accounting-period.cancel",
    "accounting-period.close",
  ],
  AUDITOR: ["accounting-period.read"],
};

export function parseAdminRole(value: string): AdminRole | null {
  return ADMIN_ROLES.find((role) => role === value) ?? null;
}

export function capabilitiesForRole(role: AdminRole): readonly AdminCapability[] {
  return ROLE_CAPABILITIES[role];
}
