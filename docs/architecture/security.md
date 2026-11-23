# Security

- API keys and GitHub tokens are only provided via environment variables or user input.
- Tokens are never printed to logs.
- In the MVP stage nothing is written back to GitHub; only drafts are generated.
- If a GitHub token needs to be persisted, it must be stored encrypted.
