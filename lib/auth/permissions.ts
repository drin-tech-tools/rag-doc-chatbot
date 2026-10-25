import type { AppRole } from "./constants";

/**
 * Permission strings for this app.
 * `*:own` = caller’s documents only; `*:any` = all documents / admin ops.
 */
export type Permission =
  | "documents:read:own"
  | "documents:read:any"
  | "documents:write:own"
  | "documents:write:any"
  | "chat:use"
  | "users:manage";

const CLIENT_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "documents:read:own",
  "documents:write:own",
  "chat:use",
]);

const ADMIN_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "documents:read:own",
  "documents:read:any",
  "documents:write:own",
  "documents:write:any",
  "chat:use",
  "users:manage",
]);

const BY_ROLE: Record<AppRole, ReadonlySet<Permission>> = {
  client: CLIENT_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
};

/** Central RBAC check — e.g. `can(user, "documents:read:any")`. */
export function can(
  user: { role: AppRole } | null | undefined,
  permission: Permission,
): boolean {
  if (!user?.role) return false;
  return BY_ROLE[user.role]?.has(permission) ?? false;
}

export function permissionsFor(role: AppRole): Permission[] {
  return [...(BY_ROLE[role] ?? [])];
}
