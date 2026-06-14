// Runnable example for @streetjs/plugin-mongodb.
// Prereq: a mongod on 127.0.0.1:27017 (e.g. `docker run -p 27017:27017 mongo:7`).
// Then: node example/index.mjs

import { MongoClient } from '../dist/index.js';

const mongo = new MongoClient({
  host: '127.0.0.1', port: 27017,
  database: process.env.MONGO_DB ?? 'app',
  ...(process.env.MONGO_USER ? { user: process.env.MONGO_USER, password: process.env.MONGO_PASSWORD } : {}),
});

await mongo.connect();
console.log('connected to MongoDB');

await mongo.insertOne('events', { kind: 'demo', at: new Date() });
const docs = await mongo.find('events', { kind: 'demo' }, { limit: 5 });
console.log('found', docs.length, 'events');

await mongo.close();
console.log('done');
