# Backend service `v1`

Single AWS Lambda (Python 3.13) serving the REST API at `/api/v1/*`.
The design and the phase plan live in [docs/project-plan.md](../../docs/project-plan.md).

## Layout

```
function.py          Lambda entry: configures logging + SIGTERM, delegates to app.http.dispatch
app/config.py        env bootstrap values + runtime settings registry + app_settings override cache
app/log.py           JSON logging with request context and redaction
app/db.py            shared connection, per-request transaction, statement timeout, shutdown hook
app/migrations.py    numbered, append-only schema migrations (schema_migrations table)
app/http.py          request parsing, router, error envelope, DB error mapping, access log
app/validation.py    declarative field validation
app/passwords.py     scrypt password hashing
app/routes.py        route table
tests/unit           no database needed
tests/integration    run against a disposable `acme_test` database on local PostgreSQL
```

## Commands

```sh
./bin/run-tests.sh backend          # ruff + bandit + pytest with coverage (creates .venv on first run)
./bin/deploy-backend.sh local       # (re)deploy to LocalStack; start-dev.sh does this when needed
curl -s localhost:3001/api/v1/health
```

Tail logs (LocalStack):

```sh
AWS_ENDPOINT_URL=http://localhost.localstack.cloud:4566 AWS_REGION=us-east-1 \
AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test \
  aws logs tail /aws/lambda/coding-workshop-v1-aacb8dd2 --follow --format short
```

## Conventions

- Every schema change is a **new** entry in `app/migrations.py`; never edit an applied one.
- Tunable values are added to `SETTINGS` in `app/config.py`; secrets stay in environment variables.
- Handlers raise `ApiError` subclasses (`NotFound`, `Conflict`, ...); `dispatch` renders the envelope
  `{"error": {"code", "message", "details", "request_id"}}`.
- Routes are transactional by default: any exception rolls back the whole request.
- Dependencies are vendored into this folder by `start-dev.sh` for LocalStack hot-reload; the
  folder's `.gitignore` tracks only source files.
