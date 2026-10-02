import { prisma } from "@/lib/prisma";
import type { TransactionType } from "@/app/generated/prisma/client";

export class LedgerError extends Error {}

function delta(type: TransactionType, amount: number) {
  return type === "DEPOSIT" ? amount : -amount;
}

export async function getCurrentBalance(): Promise<number> {
  const last = await prisma.transaction.findFirst({
    orderBy: { id: "desc" },
  });
  return last?.balanceAfter ?? 0;
}

export async function listTransactions() {
  return prisma.transaction.findMany({
    orderBy: { id: "desc" },
    include: { reversalOfTx: true, reversedByTx: true },
  });
}

// 新規取引を追加する。残高がマイナスになる取引は登録前に拒否する。
export async function createTransaction(input: {
  type: TransactionType;
  amount: number;
  description: string;
}) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    throw new LedgerError("金額は1円以上の整数で入力してください。");
  }
  if (!input.description.trim()) {
    throw new LedgerError("摘要を入力してください。");
  }

  return prisma.$transaction(async (tx) => {
    const last = await tx.transaction.findFirst({ orderBy: { id: "desc" } });
    const currentBalance = last?.balanceAfter ?? 0;
    const balanceAfter = currentBalance + delta(input.type, input.amount);

    if (balanceAfter < 0) {
      throw new LedgerError(
        `この取引を登録すると残高がマイナス(${balanceAfter}円)になるため拒否しました。`,
      );
    }

    return tx.transaction.create({
      data: {
        type: input.type,
        amount: input.amount,
        description: input.description.trim(),
        balanceAfter,
      },
    });
  });
}

// 誤りは編集・削除せず、逆仕訳(取消取引)を新規に追加して相殺する。
export async function reverseTransaction(id: number) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.transaction.findUnique({
      where: { id },
      include: { reversedByTx: true },
    });
    if (!original) throw new LedgerError("対象の取引が見つかりません。");
    if (original.reversalOf !== null) {
      throw new LedgerError(
        "取消取引は取り消せません。必要なら元の取引を新規に登録し直してください。",
      );
    }
    if (original.reversedByTx) {
      throw new LedgerError("この取引はすでに取り消されています。");
    }

    const last = await tx.transaction.findFirst({ orderBy: { id: "desc" } });
    const currentBalance = last?.balanceAfter ?? 0;
    const reversalType: TransactionType =
      original.type === "DEPOSIT" ? "WITHDRAWAL" : "DEPOSIT";
    const balanceAfter = currentBalance + delta(reversalType, original.amount);

    if (balanceAfter < 0) {
      throw new LedgerError(
        `取消により残高がマイナス(${balanceAfter}円)になるため拒否しました。`,
      );
    }

    return tx.transaction.create({
      data: {
        type: reversalType,
        amount: original.amount,
        description: `取消: ${original.description}`,
        balanceAfter,
        reversalOf: original.id,
      },
    });
  });
}

// 監査チェック:保存済みの balanceAfter を信用せず、
// 全取引を古い順に再計算し、最新のbalanceAfterと一致するか検証する。
export async function checkIntegrity() {
  const all = await prisma.transaction.findMany({ orderBy: { id: "asc" } });

  let recomputed = 0;
  const mismatches: { id: number; stored: number; recomputed: number }[] = [];

  for (const t of all) {
    recomputed += delta(t.type, t.amount);
    if (recomputed !== t.balanceAfter) {
      mismatches.push({ id: t.id, stored: t.balanceAfter, recomputed });
    }
  }

  return {
    ok: mismatches.length === 0,
    transactionCount: all.length,
    recomputedBalance: recomputed,
    storedBalance: all.at(-1)?.balanceAfter ?? 0,
    mismatches,
  };
}
