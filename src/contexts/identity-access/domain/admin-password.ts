/**
 * Admin credential hashing.
 *
 * The implementation lives in `password-hash.ts` because Admin and Member
 * credentials share one encoded format and one verification path (CR #141). The
 * admin-scoped names are kept so the Admin auth flow and its tests read the same
 * as before; the storage format is unchanged, so existing Admin hashes keep
 * verifying.
 */
export {
  hashPassword as hashAdminPassword,
  verifyPassword as verifyAdminPassword,
  PASSWORD_HASH_PREFIX,
} from "./password-hash";
