import { createStreetClient } from '@streetjs/client';
import * as orm from '@streetjs/orm';
import * as react from '@streetjs/react';
const c = createStreetClient({ baseUrl: 'http://localhost:3000' });
console.log('client.request:', typeof c.request);
console.log('client.auth.login:', typeof c.auth.login);
console.log('orm exports:', Object.keys(orm).length, 'has Entity:', 'Entity' in orm);
console.log('react hooks:', ['useAuth','useQuery','StreetProvider'].every(k=>k in react));
