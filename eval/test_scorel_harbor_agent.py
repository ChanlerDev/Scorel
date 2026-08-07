import json
import logging
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

from harbor.agents.installed.base import NonZeroAgentExitCodeError
from harbor.models.agent.context import AgentContext

from scorel_harbor_agent import (
    AGENT_COMMAND_TIMEOUT_SEC,
    SCOREL_PROCESS_TIMEOUT_SEC,
    SCOREL_TIMEOUT_MS,
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
                return_value=SimpleNamespace(
                    stdout='{"summary":{"status":"completed","usage":{},"cost":{}},"scorel_exit":0,"converter_exit":0}',
                    return_code=0,
                )
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
        self.assertIn(f"--timeout-ms {SCOREL_TIMEOUT_MS}", command)
        self.assertIn(
            f"timeout --signal=TERM --kill-after=30s {SCOREL_PROCESS_TIMEOUT_SEC}s scorel run",
            command,
        )
        self.assertEqual(call.kwargs["timeout_sec"], AGENT_COMMAND_TIMEOUT_SEC)
        self.assertGreater(SCOREL_PROCESS_TIMEOUT_SEC * 1000, SCOREL_TIMEOUT_MS)
        self.assertGreater(AGENT_COMMAND_TIMEOUT_SEC, SCOREL_PROCESS_TIMEOUT_SEC)
        self.assertGreater(AGENT_COMMAND_TIMEOUT_SEC * 1000, SCOREL_TIMEOUT_MS)
        converter = command.split("<<'PY'\n", maxsplit=1)[1].split("\nPY\n", maxsplit=1)[0]
        compile(converter, "<scorel-trajectory-converter>", "exec")

    async def test_completed_summary_normalizes_wrapper_timeout_and_maps_cache(self) -> None:
        context = AgentContext()
        with tempfile.TemporaryDirectory() as directory:
            agent = ScorelAgent(
                logs_dir=Path(directory), model_name="example/model-id", **CONNECTION
            )
            agent.exec_as_agent = AsyncMock(return_value=SimpleNamespace(
                stdout=json.dumps({
                    "summary": {
                        "status": "completed",
                        "usage": {"inputTokens": 10, "cacheReadTokens": 70, "outputTokens": 20},
                        "cost": {"known": True, "total": 0.25},
                    },
                    "scorel_exit": 124,
                    "converter_exit": 0,
                }),
                return_code=0,
            ))
            await agent.run("task", SimpleNamespace(os=None), context)

        self.assertEqual(context.n_input_tokens, 80)
        self.assertEqual(context.n_cache_tokens, 70)
        self.assertEqual(context.n_output_tokens, 20)
        self.assertEqual(context.metadata["return_code"], 124)

    async def test_failed_summary_preserves_usage_before_raising(self) -> None:
        context = AgentContext()
        with tempfile.TemporaryDirectory() as directory:
            agent = ScorelAgent(
                logs_dir=Path(directory), model_name="example/model-id", **CONNECTION
            )
            agent.exec_as_agent = AsyncMock(return_value=SimpleNamespace(
                stdout=json.dumps({
                    "summary": {
                        "status": "timeout",
                        "usage": {"inputTokens": 5, "cacheReadTokens": 30, "outputTokens": 7},
                        "cost": {"known": False},
                    },
                    "scorel_exit": 124,
                    "converter_exit": 0,
                }),
                return_code=0,
            ))
            with self.assertRaises(NonZeroAgentExitCodeError):
                await agent.run("task", SimpleNamespace(os=None), context)

        self.assertEqual(context.n_input_tokens, 35)
        self.assertEqual(context.n_cache_tokens, 30)
        self.assertEqual(context.n_output_tokens, 7)


if __name__ == "__main__":
    unittest.main()
