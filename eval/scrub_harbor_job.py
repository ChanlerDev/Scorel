"""Remove runtime connection details from a Harbor job before upload."""

import os
import sys
from pathlib import Path


REQUIRED_REDACTIONS = {
    "SCOREL_EVAL_API_KEY": b"<redacted-api-key>",
    "SCOREL_EVAL_BASE_URL": b"<redacted-base-url>",
    "SCOREL_EVAL_PROVIDER": b"<redacted-provider>",
}
OPTIONAL_REDACTIONS = {
    "DAYTONA_API_KEY": b"<redacted-daytona-api-key>",
    "DAYTONA_JWT_TOKEN": b"<redacted-daytona-jwt-token>",
    "DAYTONA_ORGANIZATION_ID": b"<redacted-daytona-organization-id>",
}


def scrub_job(root: Path, secrets: dict[bytes, bytes]) -> int:
    changed = 0
    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        scrubbed = data
        for secret, replacement in secrets.items():
            scrubbed = scrubbed.replace(secret, replacement)
        if scrubbed != data:
            path.write_bytes(scrubbed)
            changed += 1

    for path in root.rglob("*"):
        if not path.is_file() or path.is_symlink():
            continue
        data = path.read_bytes()
        if any(secret in data for secret in secrets):
            raise RuntimeError(f"secret remains in {path}")
    return changed


def secrets_from_environment() -> dict[bytes, bytes]:
    secrets: dict[bytes, bytes] = {}
    for name, replacement in REQUIRED_REDACTIONS.items():
        value = os.environ.get(name)
        if not value:
            raise RuntimeError(f"{name} is required")
        secrets[value.encode()] = replacement
    for name, replacement in OPTIONAL_REDACTIONS.items():
        value = os.environ.get(name)
        if value:
            secrets[value.encode()] = replacement
    return secrets


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: scrub_harbor_job.py <job-directory>", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"job directory does not exist: {root}", file=sys.stderr)
        return 2
    changed = scrub_job(root, secrets_from_environment())
    print(f"Scrubbed private connection details from {changed} job files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
