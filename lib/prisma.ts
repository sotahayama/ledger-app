import path from "node:path";
import { PrismaClient } from "@/app/generated/prisma/client";

function sqliteUrl(url: string | undefined) {
  if (!url) return url;
  // Prisma CLI は SQLite の相対パスを prisma/ 基準で解決するため、実行時も同じ基準に揃える
  const resolved = url.replace(
    /^file:\.\//,
    `file:${path.join(process.cwd(), "prisma")}/`,
  );
  // SQLite は同時に1本しか書き込めない。複数接続から同時に書くとロック待ちの接続で
  // 詰まり、ロックを持つ側の処理も進めなくなるため、接続を1本にして順番待ちさせる。
  if (resolved.includes("connection_limit=")) return resolved;
  return `${resolved}${resolved.includes("?") ? "&" : "?"}connection_limit=1`;
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ datasourceUrl: sqliteUrl(process.env.DATABASE_URL) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
