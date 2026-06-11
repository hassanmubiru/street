// TEMPORARY negative-control file for governance test verification.
import { writeFileSync } from 'node:fs';
const decision = 'GRANTED';
writeFileSync('platform-leadership.report.json', JSON.stringify({ decision }));
