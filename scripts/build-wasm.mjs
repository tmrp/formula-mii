import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync } from "node:fs";
execFileSync(
  "cargo",
  [
    "build",
    "--manifest-path",
    "engine/Cargo.toml",
    "--target",
    "wasm32-unknown-unknown",
    "--release",
  ],
  { stdio: "inherit" },
);
mkdirSync("public/wasm", { recursive: true });
copyFileSync(
  "engine/target/wasm32-unknown-unknown/release/replay_engine.wasm",
  "public/wasm/replay_engine.wasm",
);
