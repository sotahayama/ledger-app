import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// 開発用DBとは別の prisma/test.db を毎回作り直してからテストする
export default function setup() {
  const dbFile = path.join(__dirname, "..", "prisma", "test.db");
  rmSync(dbFile, { force: true });
  rmSync(`${dbFile}-journal`, { force: true });
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "file:./test.db" },
    stdio: "ignore",
  });
}
