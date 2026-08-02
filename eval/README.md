# Harbor / Terminal-Bench adapter

`scorel_harbor_agent.py` is a public-safe Harbor installed-agent adapter. It
contains no provider endpoint or credential. Supply the connection as Harbor
agent kwargs when starting the job:

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
harbor run \
  -d terminal-bench/terminal-bench-2-1 \
  --agent-import-path eval.scorel_harbor_agent:ScorelAgent \
  -m '<provider>/<model>' \
  --ak provider='<provider-name>' \
  --ak api='<scorel-provider-protocol>' \
  --ak base_url='<provider-base-url>' \
  --ak api_key='<provider-api-key>' \
  --ak reasoning_effort=high
```

Accepted values are `minimal`, `low`, `medium`, `high`, and `xhigh`. Omitting
the agent kwarg sends no explicit effort and preserves existing pi-ai default
behavior. Scorel writes
the selected value into its session header and run reports; the adapter also
records it in Harbor `AgentContext.metadata` and ATIF agent steps.

Never put real credentials, private endpoints, job outputs, or `.env` files in
this directory. Harbor persists agent kwargs in local job configuration, so
scrub credentials from the job directory before uploading it. `eval/.env`,
`eval/jobs/`, and Python caches are ignored.

## Repository safety

Only these public eval assets are tracked:

- `scorel_harbor_agent.py`: provider-neutral Harbor adapter.
- `test_scorel_harbor_agent.py`: tests using `example.test` and fake secrets.
- `README.md`: placeholder-only usage documentation.

The historical local adapter `scorel_agent.py`, real provider configuration,
credentials, `.env` files, and all `jobs/` outputs are intentionally ignored
and must never be force-added. Before uploading a Harbor job, replace any
runtime `api_key` and private `base_url` values persisted in its config or lock
files.
