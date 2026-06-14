// Runnable example for @streetjs/plugin-clerk.
// Prereq: CLERK_SECRET_KEY. Then: node example/index.mjs

import { ClerkClient } from '../dist/index.js';

const clerk = new ClerkClient({ secretKey: process.env.CLERK_SECRET_KEY ?? 'sk_test_demo' });

const users = await clerk.listUsers({ limit: 5 });
console.log('users:', JSON.stringify(users, null, 2));
