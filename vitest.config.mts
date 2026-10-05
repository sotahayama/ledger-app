import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    env: { DATABASE_URL: "file:./test.db" },
    globalSetup: ["./test/global-setup.ts"],
    fileParallelism: false,
  },
});
