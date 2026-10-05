import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  checkIntegrity,
  createAccount,
  createTransaction,
  LedgerError,
  listAccounts,
  reverseTransaction,
  transfer,
} from "@/lib/ledger";

async function balanceOf(accountId: number) {
  const accounts = await listAccounts();
  return accounts.find((a) => a.id === accountId)!.balance;
}

async function counts() {
  return {
    transactions: await prisma.transaction.count(),
    transfers: await prisma.transfer.count(),
  };
}

async function openAccount(name: string, initial = 0) {
  const account = await createAccount(name);
  if (initial > 0) {
    await createTransaction({
      accountId: account.id,
      type: "DEPOSIT",
      amount: initial,
      description: "初期入金",
    });
  }
  return account;
}

beforeEach(async () => {
  await prisma.transaction.deleteMany();
  await prisma.transfer.deleteMany();
  await prisma.account.deleteMany();
});

describe("入出金", () => {
  it("取引ごとに口座内の連番と残高を記録する", async () => {
    const a = await openAccount("財布", 10000);
    await createTransaction({
      accountId: a.id,
      type: "WITHDRAWAL",
      amount: 3000,
      description: "教科書",
    });

    const rows = await prisma.transaction.findMany({ orderBy: { seq: "asc" } });
    expect(rows.map((r) => [r.seq, r.balanceAfter])).toEqual([
      [1, 10000],
      [2, 7000],
    ]);
  });

  it("残高がマイナスになる出金は何も書き込まずに拒否する", async () => {
    const a = await openAccount("財布", 1000);
    const before = await counts();

    await expect(
      createTransaction({
        accountId: a.id,
        type: "WITHDRAWAL",
        amount: 1001,
        description: "過大",
      }),
    ).rejects.toThrow(LedgerError);

    expect(await counts()).toEqual(before);
    expect(await balanceOf(a.id)).toBe(1000);
  });

  it.each([0, -1, 1.5, Number.NaN])("金額 %s は拒否する", async (amount) => {
    const a = await openAccount("財布");
    await expect(
      createTransaction({ accountId: a.id, type: "DEPOSIT", amount, description: "x" }),
    ).rejects.toThrow(LedgerError);
  });
});

describe("振替", () => {
  it("振替元から引き、振替先に同額を足す", async () => {
    const a = await openAccount("財布", 10000);
    const b = await openAccount("貯金");

    const result = await transfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amount: 4000,
      description: "貯金へ",
    });

    expect(result.entries).toHaveLength(2);
    expect(await balanceOf(a.id)).toBe(6000);
    expect(await balanceOf(b.id)).toBe(4000);
    expect((await checkIntegrity()).ok).toBe(true);
  });

  it("残高不足の振替は、振替先への入金も含めて何も残さない", async () => {
    const a = await openAccount("財布", 1000);
    const b = await openAccount("貯金");
    const before = await counts();

    await expect(
      transfer({ fromAccountId: a.id, toAccountId: b.id, amount: 5000, description: "x" }),
    ).rejects.toThrow(LedgerError);

    expect(await counts()).toEqual(before);
    expect(await balanceOf(b.id)).toBe(0);
  });

  it("同じ口座同士の振替は拒否する", async () => {
    const a = await openAccount("財布", 1000);
    await expect(
      transfer({ fromAccountId: a.id, toAccountId: a.id, amount: 100, description: "x" }),
    ).rejects.toThrow("同じ口座");
  });
});

describe("取消", () => {
  it("取消は元の取引を残したまま逆向きの取引を追加する", async () => {
    const a = await openAccount("財布", 10000);
    const w = await createTransaction({
      accountId: a.id,
      type: "WITHDRAWAL",
      amount: 3000,
      description: "教科書",
    });

    await reverseTransaction(w.id);

    expect(await prisma.transaction.findUnique({ where: { id: w.id } })).not.toBeNull();
    expect(await balanceOf(a.id)).toBe(10000);
  });

  it("同じ取引の二重取消と、取消取引の取消は拒否する", async () => {
    const a = await openAccount("財布", 10000);
    const deposit = await prisma.transaction.findFirstOrThrow({ where: { accountId: a.id } });
    const { entries } = await reverseTransaction(deposit.id);

    await expect(reverseTransaction(deposit.id)).rejects.toThrow("すでに取り消され");
    await expect(reverseTransaction(entries[0].id)).rejects.toThrow("取消取引は取り消せません");
  });

  it("振替はどちらの脚を指定しても2本まとめて取り消す", async () => {
    const a = await openAccount("財布", 10000);
    const b = await openAccount("貯金");
    const { entries } = await transfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amount: 4000,
      description: "貯金へ",
    });

    const result = await reverseTransaction(entries[1].id);

    expect(result.entries).toHaveLength(2);
    expect(await balanceOf(a.id)).toBe(10000);
    expect(await balanceOf(b.id)).toBe(0);
    expect((await checkIntegrity()).ok).toBe(true);
  });

  it("振替の取消が途中で失敗したら、先に処理した側も元に戻す", async () => {
    const a = await openAccount("財布", 10000);
    const b = await openAccount("貯金");
    const { entries } = await transfer({
      fromAccountId: a.id,
      toAccountId: b.id,
      amount: 4000,
      description: "貯金へ",
    });
    // 振替先がお金を使ってしまったので、取消で振替先から4000円を戻せない
    await createTransaction({
      accountId: b.id,
      type: "WITHDRAWAL",
      amount: 4000,
      description: "使った",
    });
    const before = await counts();

    // 1本目(財布への戻し)は成功し、2本目(貯金からの引き落とし)で失敗する
    await expect(reverseTransaction(entries[0].id)).rejects.toThrow("マイナス");

    expect(await counts()).toEqual(before);
    expect(await balanceOf(a.id)).toBe(6000);
  });
});

describe("同時実行", () => {
  it("同じ口座への同時出金でも残高はマイナスにならず、成功した分だけ減る", async () => {
    const a = await openAccount("財布", 10000);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createTransaction({
          accountId: a.id,
          type: "WITHDRAWAL",
          amount: 3000,
          description: `同時出金${i}`,
        }),
      ),
    );

    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    for (const r of results) {
      if (r.status === "rejected") expect(r.reason).toBeInstanceOf(LedgerError);
    }
    expect(succeeded).toBe(3);
    expect(await balanceOf(a.id)).toBe(1000);
    expect((await checkIntegrity()).ok).toBe(true);
  });

  it("ロックを経由しない書き込みでも、同じ連番の取引はDBの一意制約が拒否する", async () => {
    const a = await openAccount("財布", 10000);
    await expect(
      prisma.transaction.create({
        data: {
          accountId: a.id,
          seq: 1,
          type: "WITHDRAWAL",
          amount: 10000,
          description: "同じ残高を元にした二重書き込み",
          balanceAfter: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("逆向きの同時振替でも、口座の合計額は変わらない", async () => {
    const a = await openAccount("財布", 10000);
    const b = await openAccount("貯金", 10000);

    await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        transfer({
          fromAccountId: i % 2 ? a.id : b.id,
          toAccountId: i % 2 ? b.id : a.id,
          amount: 1000,
          description: `往復${i}`,
        }),
      ),
    );

    expect((await balanceOf(a.id)) + (await balanceOf(b.id))).toBe(20000);
    expect((await checkIntegrity()).ok).toBe(true);
  });
});

describe("整合性チェック", () => {
  async function seed() {
    const a = await openAccount("財布", 10000);
    const b = await openAccount("貯金");
    await createTransaction({ accountId: a.id, type: "WITHDRAWAL", amount: 1000, description: "昼食" });
    await transfer({ fromAccountId: a.id, toAccountId: b.id, amount: 2000, description: "貯金へ" });
    return { a, b };
  }

  it("改ざんがなければOK", async () => {
    await seed();
    expect((await checkIntegrity()).ok).toBe(true);
  });

  it("保存された残高の書き換えを、その取引を特定して検知する", async () => {
    const { a } = await seed();
    const target = await prisma.transaction.findFirstOrThrow({
      where: { accountId: a.id, seq: 2 },
    });
    await prisma.transaction.update({ where: { id: target.id }, data: { balanceAfter: 99999 } });

    const report = await checkIntegrity();
    expect(report.ok).toBe(false);
    expect(report.issues).toContainEqual(
      expect.objectContaining({ kind: "balance", transactionId: target.id }),
    );
  });

  it("途中の取引の削除を連番の欠けとして検知する", async () => {
    const { a } = await seed();
    await prisma.transaction.deleteMany({ where: { accountId: a.id, seq: 2 } });

    const report = await checkIntegrity();
    expect(report.issues.map((i) => i.kind)).toContain("sequence");
  });

  it("振替の片方の金額の書き換えを検知する", async () => {
    const { b } = await seed();
    const leg = await prisma.transaction.findFirstOrThrow({ where: { accountId: b.id } });
    await prisma.transaction.update({
      where: { id: leg.id },
      data: { amount: 2500, balanceAfter: 2500 },
    });

    const report = await checkIntegrity();
    expect(report.issues).toContainEqual(
      expect.objectContaining({ kind: "transfer", transferId: leg.transferId }),
    );
  });
});
