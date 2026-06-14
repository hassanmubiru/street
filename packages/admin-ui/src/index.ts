// @streetjs/admin-ui — accessible, themeable React admin components built on
// @streetjs/react (which consumes @streetjs/client). Consumes existing RBAC,
// audit-log, user and tenancy APIs; no backend logic is duplicated (RFC 0002).
// React is a peer dependency. CSS-variable theming with dark mode.

export {
  UserManagement,
  RoleManager,
  AuditLogViewer,
  TenantSwitcher,
} from './components.js';
export type {
  UserManagementProps,
  RoleManagerProps,
  AuditLogViewerProps,
  TenantSwitcherProps,
  AdminUser,
  AuditLogEntry,
  Tenant,
} from './components.js';

export { StreetAdminStyles, streetAdminCss, AsyncState } from './theme.js';
export type { ClassNames } from './theme.js';
