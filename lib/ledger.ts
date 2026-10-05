import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { TransactionType } from "@/app/generated/prisma/client";

export class LedgerError extends Error {}

type Tx = Prisma.TransactionClient;

const MAX_ATTEMPTS = 10;

function delta(type: TransactionType, amount: number) {
  return type === "DEPOSIT" ? amount : -amount;
}

function opposite(type: TransactionType): TransactionType {
  return type === "DEPOSIT" ? "WITHDRAWAL" : "DEPOSIT";
}

function assertId(id: number, label: string) {
  if (!Number.isInteger(id) || id <= 0) {
    throw new LedgerError(`${label}が正しくありません。`);
  }
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new LedgerError("金額は1円以上の整数で入力してください。");
  }
}

function assertDescription(description: string) {
  if (!description.trim()) throw new LedgerError("摘要を入力してください。");
}

// 同時に同じ口座へ書き込みが来ると、(accountId, seq) の一意制約違反(P2002)や
// SQLite の書き込み競合(P2034)で後発が失敗する。最新の状態から計算し直して再試行する。
function isWriteConflict(e: unknown) {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    (e.code === "P2002" || e.code === "P2034")
  );
}

async function runAtomic<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn);
    } catch (e) {
      if (!isWriteConflict(e)) throw e;
      if (attempt >= MAX_ATTEMPTS) {
        throw new LedgerError(
          "同時に処理が集中したため登録できませんでした。もう一度お試しください。",
        );
      }
      await new Promise((r) => setTimeout(r, Math.random() * 10 * attempt));
    }
  }
}

// 残高を読む前に、対象口座の行を空更新して書き込みロックを先に取る(SELECT ... FOR UPDATE の代わり)。
// 読んでから書く順だと、同時実行時に互いのロック解放を待ち合ってデッドロックする。
// 複数口座はID順にロックし、逆向きの振替同士がロックを取り合わないようにする。
async function lockAccounts(tx: Tx, ids: number[]) {
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const locked =
      await tx.$executeRaw`UPDATE "Account" SET "name" = "name" WHERE "id" = ${id}`;
    if (locked === 0) throw new LedgerError(`口座(id=${id})が見つかりません。`);
  }
}

async function requireAccount(tx: Tx, id: number) {
  const account = await tx.account.findUnique({ where: { id } });
  if (!account) throw new LedgerError(`口座(id=${id})が見つかりません。`);
  return account;
}

// 口座の最新取引を基準に連番と残高を計算して1行追記する。残高がマイナスになるなら拒否する。
async function appendEntry(
  tx: Tx,
  entry: {
    accountId: number;
    type: TransactionType;
    amount: number;
    description: string;
    transferId?: number;
    reversalOf?: number;
  },
) {
  const account = await requireAccount(tx, entry.accountId);
  const last = await tx.transaction.findFirst({
    where: { accountId: entry.accountId },
    orderBy: { seq: "desc" },
  });
  const balanceAfter =
    (last?.balanceAfter ?? 0) + delta(entry.type, entry.amount);

  if (balanceAfter < 0) {
    throw new LedgerError(
      `「${account.name}」の残高がマイナス(${balanceAfter}円)になるため拒否しました。`,
    );
  }

  return tx.transaction.create({
    data: { ...entry, seq: (last?.seq ?? 0) + 1, balanceAfter },
  });
}

export async function createAccount(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new LedgerError("口座名を入力してください。");
  if (trimmed.length > 30) {
    throw new LedgerError("口座名は30文字以内で入力してください。");
  }
  try {
    return await prisma.account.create({ data: { name: trimmed } });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new LedgerError(`「${trimmed}」という口座はすでにあります。`);
    }
    throw e;
  }
}

export async function listAccounts() {
  const accounts = await prisma.account.findMany({
    orderBy: { id: "asc" },
    include: { transactions: { orderBy: { seq: "desc" }, take: 1 } },
  });
  return accounts.map((a) => ({
    id: a.id,
    name: a.name,
    balance: a.transactions[0]?.balanceAfter ?? 0,
  }));
}

export async function listTransactions() {
  const rows = await prisma.transaction.findMany({
    orderBy: { id: "desc" },
    include: {
      account: { select: { name: true } },
      reversedByTx: { select: { id: true } },
      transfer: {
        select: {
          entries: { select: { id: true, account: { select: { name: true } } } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountName: r.account.name,
    seq: r.seq,
    type: r.type,
    amount: r.amount,
    description: r.description,
    balanceAfter: r.balanceAfter,
    transferId: r.transferId,
    counterpartAccountName:
      r.transfer?.entries.find((e) => e.id !== r.id)?.account.name ?? null,
    reversalOf: r.reversalOf,
    reversedBy: r.reversedByTx?.id ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

export type LedgerEntry = Awaited<ReturnType<typeof listTransactions>>[number];
export type AccountSummary = Awaited<ReturnType<typeof listAccounts>>[number];

export async function createTransaction(input: {
  accountId: number;
  type: TransactionType;
  amount: number;
  description: string;
}) {
  assertId(input.accountId, "口座");
  assertAmount(input.amount);
  assertDescription(input.description);

  return runAtomic(async (tx) => {
    await lockAccounts(tx, [input.accountId]);
    return appendEntry(tx, { ...input, description: input.description.trim() });
  });
}

// 振替:出金と入金の2本を同じDBトランザクションで書く。どちらかが失敗すれば両方なかったことになる。
export async function transfer(input: {
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  description: string;
}) {
  assertId(input.fromAccountId, "振替元の口座");
  assertId(input.toAccountId, "振替先の口座");
  if (input.fromAccountId === input.toAccountId) {
    throw new LedgerError("振替元と振替先に同じ口座は指定できません。");
  }
  assertAmount(input.amount);
  assertDescription(input.description);
  const description = input.description.trim();

  return runAtomic(async (tx) => {
    await lockAccounts(tx, [input.fromAccountId, input.toAccountId]);
    const header = await tx.transfer.create({ data: {} });
    const from = await appendEntry(tx, {
      accountId: input.fromAccountId,
      type: "WITHDRAWAL",
      amount: input.amount,
      description,
      transferId: header.id,
    });
    const to = await appendEntry(tx, {
      accountId: input.toAccountId,
      type: "DEPOSIT",
      amount: input.amount,
      description,
      transferId: header.id,
    });
    return { transferId: header.id, entries: [from, to] };
  });
}

// 誤りは編集・削除せず、逆仕訳(取消取引)を新規に追加して相殺する。
// 振替の片方だけを取り消すと口座間の対応が崩れるため、振替は2本まとめて取り消す。
export async function reverseTransaction(id: number) {
  assertId(id, "取引");

  // 取引の口座は追記後に変わらないため、ロック対象の口座はトランザクションの外で調べてよい
  const legs = await prisma.transaction.findMany({
    where: { OR: [{ id }, { transfer: { entries: { some: { id } } } }] },
    select: { accountId: true },
  });
  if (legs.length === 0) throw new LedgerError("対象の取引が見つかりません。");

  return runAtomic(async (tx) => {
    await lockAccounts(tx, legs.map((l) => l.accountId));
    const original = await tx.transaction.findUnique({
      where: { id },
      include: {
        reversedByTx: true,
        transfer: {
          include: {
            entries: { include: { reversedByTx: true }, orderBy: { id: "asc" } },
          },
        },
      },
    });
    if (!original) throw new LedgerError("対象の取引が見つかりません。");

    const targets = original.transfer?.entries ?? [original];

    for (const t of targets) {
      if (t.reversalOf !== null) {
        throw new LedgerError(
          "取消取引は取り消せません。必要なら元の取引を新規に登録し直してください。",
        );
      }
      if (t.reversedByTx) {
        throw new LedgerError("この取引はすでに取り消されています。");
      }
    }

    const header = original.transferId
      ? await tx.transfer.create({ data: {} })
      : null;

    const entries = [];
    for (const t of targets) {
      entries.push(
        await appendEntry(tx, {
          accountId: t.accountId,
          type: opposite(t.type),
          amount: t.amount,
          description: `取消: ${t.description}`,
          transferId: header?.id,
          reversalOf: t.id,
        }),
      );
    }
    return { entries };
  });
}

export type IntegrityIssue = {
  kind: "sequence" | "balance" | "transfer" | "reversal";
  transactionId?: number;
  transferId?: number;
  message: string;
};

// 監査チェック:保存済みの値を信用せず、全取引から次の性質が成り立つかを検証する。
// - 口座ごとの連番が1から欠番なく続いている(途中の行の削除を検知)
// - 古い順に再計算した残高が各行の balanceAfter と一致する(残高や金額の改ざんを検知)
// - 振替は「同額の出金1本と入金1本・別口座」で構成されている
// - 取消取引は元取引と同じ口座・同額・逆向きである
export async function checkIntegrity() {
  const [accounts, all, transfers] = await Promise.all([
    prisma.account.findMany({ orderBy: { id: "asc" } }),
    prisma.transaction.findMany({ orderBy: [{ accountId: "asc" }, { seq: "asc" }] }),
    prisma.transfer.findMany({ include: { entries: true } }),
  ]);

  const issues: IntegrityIssue[] = [];
  const byId = new Map(all.map((t) => [t.id, t]));
  const balances = new Map<number, { stored: number; recomputed: number }>();

  for (const account of accounts) {
    const rows = all.filter((t) => t.accountId === account.id);
    let expectedSeq = 1;
    let recomputed = 0;
    for (const t of rows) {
      if (t.seq !== expectedSeq) {
        issues.push({
          kind: "sequence",
          transactionId: t.id,
          message: `「${account.name}」の連番が ${expectedSeq} ではなく ${t.seq} になっています(取引の欠落の可能性)。`,
        });
      }
      expectedSeq = t.seq + 1;
      recomputed += delta(t.type, t.amount);
      if (recomputed !== t.balanceAfter) {
        issues.push({
          kind: "balance",
          transactionId: t.id,
          message: `保存された残高 ${t.balanceAfter}円 が再計算した残高 ${recomputed}円 と一致しません。`,
        });
      }
    }
    balances.set(account.id, {
      stored: rows.at(-1)?.balanceAfter ?? 0,
      recomputed,
    });
  }

  for (const tr of transfers) {
    const [a, b, ...rest] = tr.entries;
    const valid =
      a &&
      b &&
      rest.length === 0 &&
      a.amount === b.amount &&
      a.type !== b.type &&
      a.accountId !== b.accountId;
    if (!valid) {
      issues.push({
        kind: "transfer",
        transferId: tr.id,
        message: `振替 #${tr.id} の出金と入金が対応していません。`,
      });
    }
  }

  for (const t of all) {
    if (t.reversalOf === null) continue;
    const original = byId.get(t.reversalOf);
    const valid =
      original &&
      original.accountId === t.accountId &&
      original.amount === t.amount &&
      original.type !== t.type;
    if (!valid) {
      issues.push({
        kind: "reversal",
        transactionId: t.id,
        message: `取消取引が元の取引 #${t.reversalOf} と対応していません。`,
      });
    }
  }

  return {
    ok: issues.length === 0,
    transactionCount: all.length,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      ...balances.get(a.id)!,
    })),
    issues,
  };
}

export type IntegrityReport = Awaited<ReturnType<typeof checkIntegrity>>;
