"""Harbor installed-agent adapter for public Scorel evaluations.

Provider connection details are intentionally supplied only as runtime agent
kwargs. This file must remain safe to publish.
"""

import base64
import json
import shlex
from typing import Any, override

from harbor.agents.installed.base import BaseInstalledAgent, CliFlag
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext
from harbor.models.trial.paths import EnvironmentPaths
from harbor.models.trial.result import AgentInfo, ModelInfo


REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"]
PROVIDER_APIS = [
    "openai-completions",
    "openai-responses",
    "google-generative-ai",
    "anthropic-messages",
]


class ScorelAgent(BaseInstalledAgent):
    """Run Scorel through its headless CLI and export Harbor observations."""

    SUPPORTS_ATIF = True
    CLI_FLAGS = [
        CliFlag("provider", cli="--provider"),
        CliFlag("api", cli="--api", type="enum", choices=PROVIDER_APIS),
        CliFlag("base_url", cli="--base-url"),
        CliFlag("api_key", cli="--api-key"),
        CliFlag(
            "reasoning_effort",
            cli="--reasoning-effort",
            type="enum",
            choices=REASONING_EFFORTS,
        ),
    ]

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        model_id = _model_id_from_harbor_model_name(self.model_name)
        if not model_id:
            raise ValueError("ScorelAgent requires Harbor model_name (-m <provider>/<model>)")
        self.model_id = model_id
        self.provider = _required_flag(self._resolved_flags, "provider")
        self.api = _required_flag(self._resolved_flags, "api")
        self.base_url = _required_flag(self._resolved_flags, "base_url")
        self.api_key = _required_flag(self._resolved_flags, "api_key")
        self.reasoning_effort: str | None = self._resolved_flags.get(
            "reasoning_effort"
        )

    @staticmethod
    @override
    def name() -> str:
        return "scorel"

    @override
    def get_version_command(self) -> str | None:
        return "scorel --version"

    @override
    def to_agent_info(self) -> AgentInfo:
        info = super().to_agent_info()
        provider = _provider_from_harbor_model_name(self.model_name)
        return AgentInfo(
            name=info.name,
            version=info.version,
            model_info=ModelInfo(name=self.model_id, provider=provider),
        )

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(
            environment,
            command=(
                "set -euo pipefail; "
                "if ! command -v node >/dev/null 2>&1 || "
                "! node -e \"process.exit(parseInt(process.versions.node) >= 22 ? 0 : 1)\"; then "
                "  if command -v apt-get >/dev/null 2>&1; then "
                "    apt-get update; apt-get install -y curl ca-certificates gnupg; "
                "    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -; "
                "    apt-get install -y nodejs; "
                "  elif command -v apk >/dev/null 2>&1; then "
                "    apk add --no-cache nodejs npm; "
                "  else echo 'Scorel requires Node.js 22+' >&2; exit 1; fi; "
                "fi; "
                "npm install -g @chanlerdev/scorel; scorel --version"
            ),
            env={"DEBIAN_FRONTEND": "noninteractive"},
        )

    @override
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        paths = EnvironmentPaths.for_os(environment.os)
        instruction_b64 = base64.b64encode(instruction.encode()).decode()
        summary_path = paths.agent_dir / "scorel-summary.json"
        stdout_path = paths.agent_dir / "scorel-stream.log"
        report_dir = paths.agent_dir.parent / "artifacts" / "scorel"
        trajectory_path = paths.agent_dir / "trajectory.json"
        state_dir = paths.agent_dir / "scorel-state"
        effort_flag = (
            f"--reasoning-effort {shlex.quote(self.reasoning_effort)}"
            if self.reasoning_effort
            else ""
        )
        command = f"""
set -euo pipefail
mkdir -p {shlex.quote(str(state_dir))} {shlex.quote(str(report_dir))} {shlex.quote(str(paths.agent_dir))}
printf %s {shlex.quote(instruction_b64)} | base64 -d > {shlex.quote(str(state_dir / "instruction.txt"))}
set +e
scorel run \
  --prompt-file {shlex.quote(str(state_dir / "instruction.txt"))} \
  --cwd "$PWD" \
  --state-dir {shlex.quote(str(state_dir))} \
  --summary {shlex.quote(str(summary_path))} \
  --report-dir {shlex.quote(str(report_dir))} \
  --output-format none \
  --timeout-ms 1800000 \
  --provider {shlex.quote(self.provider)} \
  --api {shlex.quote(self.api)} \
  --base-url {shlex.quote(self.base_url)} \
  --api-key {shlex.quote(self.api_key)} \
  --model {shlex.quote(self.model_id)} \
  {effort_flag} > {shlex.quote(str(stdout_path))} 2>&1
SCOREL_EXIT=$?
set -e
set +e
python3 - {shlex.quote(str(report_dir / "scorel-trajectory.json"))} {shlex.quote(str(trajectory_path))} {shlex.quote(self.model_id)} {shlex.quote(self.reasoning_effort or "")} <<'PY'
import json, sys
source_path, target_path, model_id, effort = sys.argv[1:]
try:
    source = json.load(open(source_path, encoding="utf-8"))
except (OSError, json.JSONDecodeError):
    source = {{}}
steps = []
for event in source.get("events", []):
    kind = event.get("type")
    message = event.get("message") or {{}}
    parts = message.get("content") or []
    if kind == "user_message":
        text = "\\n".join(part.get("text", "") for part in parts if isinstance(part, dict))
        steps.append({{"source": "user", "message": text or "[user message]"}})
    elif kind == "assistant_message":
        visible = []
        reasoning = []
        for part in parts:
            if not isinstance(part, dict): continue
            if part.get("type") == "thinking": reasoning.append(part.get("text", ""))
            elif part.get("type") == "text": visible.append(part.get("text", ""))
        step = {{"source": "agent", "model_name": model_id, "message": "\\n".join(visible) or "[assistant message]"}}
        if effort: step["reasoning_effort"] = effort
        if reasoning: step["reasoning_content"] = "\\n".join(reasoning)
        steps.append(step)
if not steps:
    steps = [{{"source": "system", "message": "Scorel produced no convertible trajectory events."}}]
for index, step in enumerate(steps, 1): step["step_id"] = index
usage = source.get("usage") or {{}}
cost = source.get("cost") or {{}}
trajectory = {{
    "schema_version": "ATIF-v1.7",
    "session_id": source.get("sessionId"),
    "agent": {{"name": "scorel", "version": "unknown", "model_name": model_id, "extra": {{"reasoning_effort": effort or None}}}},
    "steps": steps,
    "final_metrics": {{
        "total_prompt_tokens": usage.get("inputTokens"),
        "total_completion_tokens": usage.get("outputTokens"),
        "total_cost_usd": cost.get("total") if cost.get("known") is True else None,
        "total_steps": len(steps),
    }},
}}
with open(target_path, "w", encoding="utf-8") as output:
    json.dump(trajectory, output, indent=2)
PY
CONVERTER_EXIT=$?
set -e
cat {shlex.quote(str(summary_path))} 2>/dev/null || true
if [ "$SCOREL_EXIT" -ne 0 ]; then exit "$SCOREL_EXIT"; fi
exit "$CONVERTER_EXIT"
"""
        result = await self.exec_as_agent(
            environment,
            command=command,
            timeout_sec=1800,
        )
        summary = _parse_summary(getattr(result, "stdout", ""))
        usage = summary.get("usage") if isinstance(summary.get("usage"), dict) else {}
        cost = summary.get("cost") if isinstance(summary.get("cost"), dict) else {}
        context.n_input_tokens = int(usage.get("inputTokens") or 0)
        context.n_output_tokens = int(usage.get("outputTokens") or 0)
        context.n_cache_tokens = 0
        context.cost_usd = (
            float(cost.get("total") or 0) if cost.get("known") is True else 0.0
        )
        context.metadata = {
            "reasoning_effort": self.reasoning_effort,
            "scorel_model_id": self.model_id,
            "scorel_summary_path": str(summary_path),
            "scorel_report_dir": str(report_dir),
            "scorel_trajectory_path": str(report_dir / "scorel-trajectory.json"),
            "harbor_trajectory_path": str(trajectory_path),
            "return_code": getattr(result, "return_code", None),
        }


def _parse_summary(output: str | bytes | None) -> dict[str, Any]:
    if isinstance(output, bytes):
        output = output.decode(errors="replace")
    try:
        value = json.loads((output or "").strip())
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _required_flag(flags: dict[str, Any], name: str) -> str:
    value = flags.get(name)
    if not isinstance(value, str) or not value:
        raise ValueError(f"ScorelAgent requires --ak {name}=<value>")
    return value


def _model_id_from_harbor_model_name(model_name: str | None) -> str | None:
    if not model_name:
        return None
    return model_name.split("/", maxsplit=1)[1] if "/" in model_name else model_name


def _provider_from_harbor_model_name(model_name: str | None) -> str | None:
    if not model_name or "/" not in model_name:
        return None
    return model_name.split("/", maxsplit=1)[0]
