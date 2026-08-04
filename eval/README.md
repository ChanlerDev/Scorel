# Harbor / Terminal-Bench adapter

This directory is a public-safe Harbor / Terminal-Bench harness for Scorel. It
contains no real provider identity, endpoint, credential, or benchmark job.

## Quick start

Install and authenticate [Harbor](https://github.com/laude-institute/harbor),
including the sandbox backend you intend to use. Then:

```bash
cp eval/.env.example eval/.env
chmod 600 eval/.env
# Edit eval/.env with your own connection and model.
./eval/run_terminal_bench.sh
```

The launcher defaults to Terminal-Bench 2.1, Daytona, two attempts per task,
three concurrent trials, and `max` reasoning. Every value is configurable in
the ignored `eval/.env`. Set `SCOREL_EVAL_UPLOAD_PRIVATE=true` only when the
completed, scrubbed job should be uploaded privately to Harbor.

Daytona runs also require `DAYTONA_API_KEY`, or both `DAYTONA_JWT_TOKEN` and
`DAYTONA_ORGANIZATION_ID`, in the private `eval/.env`. The launcher exports
only those sandbox credentials required by Harbor; Scorel provider connection
values continue to travel through agent kwargs and Scorel CLI flags.

## What the adapter provides

`scorel_harbor_agent.py` is a Harbor installed-agent adapter. For every trial
it installs the released `@chanlerdev/scorel` CLI in the sandbox, forwards the
task instruction to `scorel run`, and collects:

- Scorel's machine-readable summary and event/report artifacts;
- token usage and estimated cost for Harbor's `AgentContext`;
- model and reasoning-effort metadata;
- an ATIF trajectory generated from Scorel's persisted events.

The adapter supports OpenAI Completions, OpenAI Responses, Google Generative
AI, and Anthropic Messages protocols, plus all six Scorel reasoning values. The
launcher exposes Harbor dataset, environment, attempt count, concurrency,
model, and private-upload settings, so users normally do not need to edit the
Python adapter.

## Manual Harbor invocation

Supply the connection as Harbor agent kwargs when starting a job:

```bash
harbor run ... \
  --ak provider='<provider-name>' \
  --ak api='<scorel-provider-protocol>' \
  --ak base_url='<provider-base-url>' \
  --ak api_key='<provider-api-key>'
```

From the Scorel repository root, run Harbor with the custom adapter and an
explicit reasoning effort. Do not also pass `-a`; the import path is the agent
selection:

```bash
PYTHONPATH=. harbor run \
  -d terminal-bench/terminal-bench-2-1 \
  --agent-import-path eval.scorel_harbor_agent:ScorelAgent \
  -m '<provider>/<model>' \
  --ak provider='<provider-name>' \
  --ak api='<scorel-provider-protocol>' \
  --ak base_url='<provider-base-url>' \
  --ak api_key='<provider-api-key>' \
  --ak reasoning_effort=max
```

Accepted values are `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`. Omitting
the agent kwarg sends no explicit effort and preserves existing pi-ai default
behavior. Scorel writes
the selected value into its session header and run reports; the adapter also
records it in Harbor `AgentContext.metadata` and ATIF agent steps.

For repeated local runs, keep secrets in ignored `eval/.env` rather than in a
script. Copy the complete `.env.example` template, fill every required field,
and keep its permissions at `600`.

The launcher sources `eval/.env` as shell variables rather than exporting the
connection to Harbor's environment. Harbor receives it through agent kwargs,
and the adapter forwards it through Scorel CLI flags. The launcher runs
`scrub_harbor_job.py` before an optional private upload.

Never put real credentials, private endpoints, job outputs, or `.env` files in
this directory. Harbor persists agent kwargs in local job configuration, so
scrub credentials from the job directory before uploading it. `eval/.env`,
`eval/jobs/`, and Python caches are ignored.

## Repository safety

Only these public eval assets are tracked:

- `scorel_harbor_agent.py`: provider-neutral Harbor adapter.
- `run_terminal_bench.sh`: configurable end-to-end launcher.
- `scrub_harbor_job.py`: mandatory pre-upload connection scrubber.
- `.env.example`: placeholders and public-safe defaults only.
- `test_*.py`: tests using reserved example domains and fake secrets.
- `README.md`: placeholder-only usage documentation.

The historical local adapter `scorel_agent.py`, real provider configuration,
credentials, `.env` files, and all `jobs/` outputs are intentionally ignored
and must never be force-added. Before uploading a Harbor job, replace any
runtime `api_key` and private `base_url` values persisted in its config or lock
files.
