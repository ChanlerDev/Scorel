import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from harbor.models.agent.context import AgentContext

from scorel_harbor_agent import (
    ScorelAgent,
    _model_id_from_harbor_model_name,
)

CONNECTION = {
    "provider": "example",
    "api": "openai-responses",
    "base_url": "https://llm.example.test/v1",
    "api_key": "test-secret",
}


class ScorelHarborAgentTest(unittest.IsolatedAsyncioTestCase):
    def test_accepts_and_records_reasoning_effort(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            agent = ScorelAgent(
                logs_dir=Path(directory),
                model_name="example/model-id",
                reasoning_effort="max",
                **CONNECTION,
                logger=logging.getLogger("scorel-eval-test"),
            )
        self.assertEqual(agent.model_id, "model-id")
        self.assertEqual(agent.reasoning_effort, "max")

    def test_rejects_unknown_reasoning_effort(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Valid values"):
                ScorelAgent(
                    logs_dir=Path(directory),
                    model_name="example/model-id",
                    reasoning_effort="maximum",
                    **CONNECTION,
                )

    def test_extracts_model_id_without_persisting_provider_configuration(self) -> None:
        self.assertEqual(_model_id_from_harbor_model_name("example/model-id"), "model-id")

    async def test_run_forwards_connection_as_scorel_cli_flags(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            agent = ScorelAgent(
                logs_dir=Path(directory),
                model_name="example/model-id",
                reasoning_effort="high",
                **CONNECTION,
            )
            agent.exec_as_agent = AsyncMock(
                return_value=SimpleNamespace(stdout='{"usage": {}, "cost": {}}', return_code=0)
            )
            await agent.run(
                "complete the task",
                SimpleNamespace(os=None),
                AgentContext(),
            )

        call = agent.exec_as_agent.await_args
        command = call.kwargs["command"]
        self.assertNotIn("env", call.kwargs)
        self.assertIn("--provider example", command)
        self.assertIn("--api openai-responses", command)
        self.assertIn("--base-url https://llm.example.test/v1", command)
        self.assertIn("--api-key test-secret", command)
        self.assertIn("--reasoning-effort high", command)
        converter = command.split("<<'PY'\n", maxsplit=1)[1].split("\nPY\n", maxsplit=1)[0]
        compile(converter, "<scorel-trajectory-converter>", "exec")


if __name__ == "__main__":
    unittest.main()
