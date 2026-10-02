"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type Transaction = {
  id: number;
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  description: string;
  balanceAfter: number;
  reversalOf: number | null;
  createdAt: string;
  reversedByTx: { id: number } | null;
};

export type Integrity = {
  ok: boolean;
  transactionCount: number;
  recomputedBalance: number;
  storedBalance: number;
  mismatches: { id: number; stored: number; recomputed: number }[];
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
});

export function Ledger({
  transactions,
  integrity,
}: {
  transactions: Transaction[];
  integrity: Integrity;
}) {
  const router = useRouter();
  const [type, setType] = useState<"DEPOSIT" | "WITHDRAWAL">("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = () => router.refresh();

  const balance = transactions[0]?.balanceAfter ?? 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, amount: Number(amount), description }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setAmount("");
      setDescription("");
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleReverse(id: number) {
    setError(null);
    const res = await fetch(`/api/transactions/${id}/reverse`, {
      method: "POST",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    await refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-bold">台帳アプリ</h1>
        <p className="text-sm text-gray-500">
          取引は追記のみ。誤りは編集・削除せず、取消取引を新規追加して相殺します。
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <div className="text-sm text-gray-500">現在の残高</div>
          <div className="text-2xl font-bold">{yen.format(balance)}</div>
        </div>
        <div
          className={`rounded-lg border p-4 ${
            integrity.ok
              ? "border-green-400 bg-green-50"
              : "border-red-400 bg-red-50"
          }`}
        >
          <div className="text-sm text-gray-500">整合性チェック</div>
          <div className="text-2xl font-bold">
            {integrity.ok ? "OK" : "不整合あり"}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            全{integrity.transactionCount}件を再計算 / 再計算残高{" "}
            {yen.format(integrity.recomputedBalance)}
          </div>
          {integrity.mismatches.length > 0 && (
            <div className="mt-1 text-xs text-red-600">
              不一致: {integrity.mismatches.map((m) => `#${m.id}`).join(", ")}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">取引を追加</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex gap-2">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="type"
                checked={type === "DEPOSIT"}
                onChange={() => setType("DEPOSIT")}
              />
              入金
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                name="type"
                checked={type === "WITHDRAWAL"}
                onChange={() => setType("WITHDRAWAL")}
              />
              出金
            </label>
          </div>
          <input
            type="number"
            min={1}
            placeholder="金額(円)"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="rounded border px-3 py-2"
            required
          />
          <input
            type="text"
            placeholder="摘要"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded border px-3 py-2"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            登録
          </button>
        </form>
      </section>

      <section className="rounded-lg border">
        <h2 className="border-b p-4 font-semibold">取引履歴</h2>
        <ul className="divide-y">
          {transactions.map((t) => (
            <li key={t.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">
                  {t.type === "DEPOSIT" ? "入金" : "出金"} {yen.format(t.amount)}
                  {t.reversalOf && (
                    <span className="ml-2 text-xs text-gray-500">
                      (#{t.reversalOf} の取消)
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">{t.description}</div>
                <div className="text-xs text-gray-400">
                  残高 {yen.format(t.balanceAfter)} ・{" "}
                  {new Date(t.createdAt).toLocaleString("ja-JP")}
                </div>
              </div>
              {!t.reversedByTx && !t.reversalOf && (
                <button
                  onClick={() => handleReverse(t.id)}
                  className="rounded border px-3 py-1 text-sm hover:bg-gray-50"
                >
                  取り消す
                </button>
              )}
              {t.reversedByTx && (
                <span className="text-xs text-gray-400">取消済み</span>
              )}
            </li>
          ))}
          {transactions.length === 0 && (
            <li className="p-4 text-sm text-gray-400">取引はまだありません</li>
          )}
        </ul>
      </section>
    </main>
  );
}
