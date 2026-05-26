# Street Framework

[![CI](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)

See `docs/README.md` for full documentation. To run tests locally, use the provided helper script:

```bash
./scripts/test-setup.sh
```

Or manually:

```bash
docker-compose up -d postgres
# wait until healthy
PG_HOST=127.0.0.1 PG_PORT=55432 PG_USER=street PG_PASSWORD=street_secret PG_DATABASE=street_test npm run test:run
```
