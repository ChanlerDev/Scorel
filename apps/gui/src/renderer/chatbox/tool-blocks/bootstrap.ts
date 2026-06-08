import { DefaultJsonBlock } from "./DefaultJsonBlock.js";
import { registerToolBlock, setToolBlockFallback } from "./registry.js";

setToolBlockFallback(DefaultJsonBlock);

// S0069: register the seven first-class coding tools as DefaultJsonBlock
// fallbacks so the registry path is exercised. S0070 will swap in specialized
// implementations (ReadBlock, GlobGrepBlock, EditWriteBlock, BashBlock,
// TodoWriteBlock) without touching the rendering main path.
const FALLBACK_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "Bash",
  "TodoWrite",
];

for (const name of FALLBACK_TOOLS) {
  registerToolBlock(name, DefaultJsonBlock);
}
