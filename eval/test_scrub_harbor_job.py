import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scrub_harbor_job import scrub_job, secrets_from_environment


class ScrubHarborJobTest(unittest.TestCase):
    def test_replaces_connection_details_without_changing_model_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            job = Path(directory)
            config = job / "config.json"
            config.write_text(
                '{"provider":"private-provider","base_url":"https://private.example.test/v1",'
                '"api_key":"private-test-key","model":"example-model"}',
                encoding="utf-8",
            )

            changed = scrub_job(
                job,
                {
                    b"private-provider": b"<redacted-provider>",
                    b"https://private.example.test/v1": b"<redacted-base-url>",
                    b"private-test-key": b"<redacted-api-key>",
                },
            )

            self.assertEqual(changed, 1)
            scrubbed = config.read_text(encoding="utf-8")
            self.assertNotIn("private-provider", scrubbed)
            self.assertNotIn("private-test-key", scrubbed)
            self.assertIn('"model":"example-model"', scrubbed)

    def test_includes_optional_daytona_credentials_when_present(self) -> None:
        environment = {
            "SCOREL_EVAL_PROVIDER": "example-provider",
            "SCOREL_EVAL_BASE_URL": "https://api.example.test/v1",
            "SCOREL_EVAL_API_KEY": "fake-test-key",
            "DAYTONA_API_KEY": "fake-daytona-key",
        }
        with patch.dict("os.environ", environment, clear=True):
            secrets = secrets_from_environment()

        self.assertIn(b"fake-daytona-key", secrets)
        self.assertNotIn(b"DAYTONA_JWT_TOKEN", secrets)


if __name__ == "__main__":
    unittest.main()
