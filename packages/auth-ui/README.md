# @streetjs/auth-ui

Accessible, themeable React auth components for
[StreetJS](https://hassanmubiru.github.io/street/), built on
[`@streetjs/react`](https://www.npmjs.com/package/@streetjs/react). CSS-variable
theming with built-in dark mode; no CSS-in-JS runtime. React is a peer dependency.

```bash
npm install @streetjs/client @streetjs/react @streetjs/auth-ui react
```

## Components

`LoginForm`, `RegisterForm`, `ForgotPasswordForm`, `MFASetup`, `ProfileSettings`,
plus `StreetAuthStyles` (default stylesheet) and primitives (`Field`, `Button`, `ErrorText`).

```tsx
import { StreetProvider } from '@streetjs/react';
import { createStreetClient } from '@streetjs/client';
import { LoginForm, StreetAuthStyles } from '@streetjs/auth-ui';

const client = createStreetClient({ baseUrl: '/api', credentials: 'include' });

function SignIn() {
  return (
    <StreetProvider client={client}>
      <StreetAuthStyles />
      <LoginForm theme="dark" onSuccess={() => location.assign('/')} />
    </StreetProvider>
  );
}
```

Components consume your existing StreetJS auth APIs (JWT/sessions/RBAC/MFA) — no
backend logic is duplicated. Theme via the `theme` prop (`light`/`dark`) or by
overriding the `--st-*` CSS variables.

> **Status:** `0.1.x` preview — pre-1.0. Verified by build + type-check +
> export-shape tests (not full DOM render tests).

## License

MIT
