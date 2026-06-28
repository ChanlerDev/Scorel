import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadScorelConfigProfile, renderObservabilityConfig } from "./index.js";

const baseConfig = `
[providers.test]
type = "custom"
provider = "openai"
api = "openai-completions"
baseUrl = "http://127.0.0.1:1"
apiKeyEnv = "OPENAI_API_KEY"

[provider_models.main]
provider = "test"
id = "gpt-4o-mini"
displayName = "GPT-4o mini"

[available_models.main]
model = "main"
displayName = "GPT-4o mini"

[model_profile.roles]
primary = "main"
standard = "main"
auxiliary = "main"
`;

describe("observability config", () => {
  it("loads observability sync settings from device config", async () => {
    const scorelHomeDir = await mkdtemp(join(tmpdir(), "scorel-observability-config-"));
    await writeFile(
      join(scorelHomeDir, "config.toml"),
      `${baseConfig}
[observability]
local = true

[observability.sync]
enabled = true
mode = "manual"
targets = "langfuse,otel"

[observability.langfuse]
enabled = true
host = "https://cloud.langfuse.com"
publicKey = "pk-lf-test"
secretKey = "sk-lf-test"

[observability.otel]
enabled = true
endpoint = "http://127.0.0.1:4318"
protocol = "otlp-http"
`,
    );

    const config = await loadScorelConfigProfile({ cwd: "/repo", scorelHomeDir, env: {} });

    expect(config.observability).toEqual({
      local: true,
      sync: { enabled: true, mode: "manual", targets: ["langfuse", "otel"] },
      langfuse: {
        enabled: true,
        host: "https://cloud.langfuse.com",
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
      },
      otel: {
        enabled: true,
        endpoint: "http://127.0.0.1:4318",
        protocol: "otlp-http",
      },
    });
  });

  it("ignores unknown observability keys through the schema path", async () => {
    const scorelHomeDir = await mkdtemp(join(tmpdir(), "scorel-observability-config-bad-"));
    await writeFile(
      join(scorelHomeDir, "config.toml"),
      `${baseConfig}
[observability]
local = false
surprise = true
`,
    );

    await expect(loadScorelConfigProfile({ cwd: "/repo", scorelHomeDir, env: {} })).resolves.toMatchObject({
      observability: { local: false },
    });
  });

  it("removes optional observability endpoints when a GUI patch clears them", () => {
    const config = renderObservabilityConfig({
      existingConfigText: `${baseConfig}
[observability]
local = true

[observability.sync]
enabled = true
mode = "auto"
targets = "langfuse,otel"

[observability.langfuse]
enabled = true
host = "https://cloud.langfuse.com"
publicKey = "pk-lf-test"
secretKey = "sk-lf-test"

[observability.otel]
enabled = true
endpoint = "http://127.0.0.1:4318"
protocol = "otlp-http"
`,
      langfuse: { host: undefined, publicKey: undefined },
      otel: { endpoint: undefined },
    });

    expect(config).not.toContain("host =");
    expect(config).not.toContain("publicKey =");
    expect(config).toContain('secretKey = "sk-lf-test"');
    expect(config).not.toContain("endpoint =");
  });
});
