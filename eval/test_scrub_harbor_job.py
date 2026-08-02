import tempfile
import unittest
from pathlib import Path

from scrub_harbor_job import scrub_job


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


if __name__ == "__main__":
    unittest.main()
