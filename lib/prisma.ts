import path from "node:path";
import { PrismaClient } from "@/app/generated/prisma/client";

// Prisma CLI は SQLite の相対パスを prisma/ 基準で解決するため、実行時も同じ基準に揃える
const datasourceUrl = process.env.DATABASE_URL?.replace(
  /^file:\.\//,
  `file:${path.join(process.cwd(), "prisma")}/`,
);

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
