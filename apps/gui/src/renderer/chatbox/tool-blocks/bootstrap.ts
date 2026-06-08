import { BashBlock } from "./BashBlock.js";
import { DefaultJsonBlock } from "./DefaultJsonBlock.js";
import { EditWriteBlock } from "./EditWriteBlock.js";
import { GlobGrepBlock } from "./GlobGrepBlock.js";
import { ReadBlock } from "./ReadBlock.js";
import { TodoWriteBlock } from "./TodoWriteBlock.js";
import { registerToolBlock, setToolBlockFallback } from "./registry.js";

setToolBlockFallback(DefaultJsonBlock);

registerToolBlock("Read", ReadBlock);
registerToolBlock("Glob", GlobGrepBlock);
registerToolBlock("Grep", GlobGrepBlock);
registerToolBlock("Edit", EditWriteBlock);
registerToolBlock("Write", EditWriteBlock);
registerToolBlock("Bash", BashBlock);
registerToolBlock("TodoWrite", TodoWriteBlock);
