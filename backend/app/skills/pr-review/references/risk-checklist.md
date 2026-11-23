# PR Risk Checklist

This checklist only helps the agent choose what to check; every conclusion must still be tied to the PR diff, review comments or CI evidence.

- API and data: check request/response compatibility, database migrations, default values and rollback paths.
- Permissions and security: check authentication, authorization, sensitive data, input validation and audit records.
- Concurrency and state: check duplicate requests, race conditions, transaction scope, retries and idempotency.
- Tests and release: check tests for key branches, failed CI, configuration changes and deployment impact.
- Maintainability: check complex logic, duplicated implementations, error handling and necessary documentation.

Items the checklist does not hit can be skipped; never turn an unsupported possibility into a P1/P2 just because it is on the checklist.
