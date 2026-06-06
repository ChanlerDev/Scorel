#!/usr/bin/env node
process.env.SCOREL_SKIP_INDEX_ENTRY = "1";

const { runCli } = await import("./index.js");

runCli(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
