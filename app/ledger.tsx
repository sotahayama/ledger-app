"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AccountSummary, IntegrityReport, LedgerEntry } from "@/lib/ledger";

type Mode = "DEPOSIT" | "WITHDRAWAL" | "TRANSFER";

const yen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY" });

const modeLabel: Record<Mode, string> = {
  DEPOSIT: "入金",
  WITHDRAWAL: "出金",
  TRANSFER: "振替",
};

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return (data.error as string) ?? "処理に失敗しました。";
}

export function Ledger({
  accounts,
  transactions,
  integrity,
}: {
  accounts: AccountSummary[];
  transactions: LedgerEntry[];
  integrity: IntegrityReport;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string | null>) {
    setError(null);
    setBusy(true);
    try {
      const message = await action();
      if (message) {
        setError(message);
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold">台帳アプリ</h1>
        <p className="text-sm text-gray-500">
          取引は追記のみ。誤りは編集・削除せず、取消取引を新規追加して相殺します。
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <Accounts accounts={accounts} busy={busy} run={run} />
        <Integrity integrity={integrity} />
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <EntryForm accounts={accounts} busy={busy} run={run} />
      <History
        accounts={accounts}
        transactions={transactions}
        busy={busy}
        onReverse={(t) =>
          run(() => post(`/api/transactions/${t.id}/reverse`))
        }
      />
    </main>
  );
}

type Run = (action: () => Promise<string | null>) => Promise<boolean>;

function Accounts({
  accounts,
  busy,
  run,
}: {
  accounts: AccountSummary[];
  busy: boolean;
  run: Run;
}) {
  const [name, setName] = useState("");
  const total = accounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-2 font-semibold">口座</h2>
      <ul className="mb-3 divide-y text-sm">
        {accounts.map((a) => (
          <li key={a.id} className="flex justify-between py-1.5">
            <span>{a.name}</span>
            <span className="font-medium tabular-nums">{yen.format(a.balance)}</span>
          </li>
        ))}
        {accounts.length > 0 && (
          <li className="flex justify-between py-1.5 font-semibold">
            <span>合計</span>
            <span className="tabular-nums">{yen.format(total)}</span>
          </li>
        )}
        {accounts.length === 0 && (
          <li className="py-1.5 text-gray-400">まず口座を作成してください</li>
        )}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => post("/api/accounts", { name }))) setName("");
        }}
      >
        <input
          aria-label="新しい口座名"
          placeholder="新しい口座名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border px-3 py-1.5 text-sm"
          maxLength={30}
          required
        />
        <button
          disabled={busy}
          className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
        >
          追加
        </button>
      </form>
    </section>
  );
}

function Integrity({ integrity }: { integrity: IntegrityReport }) {
  return (
    <section
      className={`rounded-lg border p-4 ${
        integrity.ok ? "border-green-400 bg-green-50" : "border-red-400 bg-red-50"
      }`}
    >
      <h2 className="text-sm text-gray-500">整合性チェック</h2>
      <div className="text-2xl font-bold">{integrity.ok ? "OK" : "不整合あり"}</div>
      <p className="mt-1 text-xs text-gray-500">
        全{integrity.transactionCount}件を再計算し、連番・残高・振替・取消の対応を検証
      </p>
      {integrity.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-red-700">
          {integrity.issues.map((issue, i) => (
            <li key={i}>
              {issue.transactionId && `#${issue.transactionId}: `}
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EntryForm({
  accounts,
  busy,
  run,
}: {
  accounts: AccountSummary[];
  busy: boolean;
  run: Run;
}) {
  const [mode, setMode] = useState<Mode>("DEPOSIT");
  const [accountId, setAccountId] = useState<number | null>(null);
  const [toAccountId, setToAccountId] = useState<number | null>(null);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const from = accountId ?? accounts[0]?.id ?? null;
  const to =
    (toAccountId !== from ? toAccountId : null) ??
    accounts.find((a) => a.id !== from)?.id ??
    null;
  const disabled = busy || accounts.length === 0 || (mode === "TRANSFER" && accounts.length < 2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() =>
      mode === "TRANSFER"
        ? post("/api/transfers", {
            fromAccountId: from,
            toAccountId: to,
            amount: Number(amount),
            description,
          })
        : post("/api/transactions", {
            accountId: from,
            type: mode,
            amount: Number(amount),
            description,
          }),
    );
    if (ok) {
      setAmount("");
      setDescription("");
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="mb-3 font-semibold">取引を追加</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <fieldset className="flex gap-4">
          <legend className="sr-only">取引の種類</legend>
          {(Object.keys(modeLabel) as Mode[]).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input
                type="radio"
                name="mode"
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {modeLabel[m]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <AccountSelect
            label={mode === "TRANSFER" ? "振替元" : "口座"}
            accounts={accounts}
            value={from}
            onChange={setAccountId}
          />
          {mode === "TRANSFER" && (
            <>
              <span className="hidden text-gray-400 sm:inline">→</span>
              <AccountSelect
                label="振替先"
                accounts={accounts.filter((a) => a.id !== from)}
                value={to}
                onChange={setToAccountId}
              />
            </>
          )}
        </div>
        {mode === "TRANSFER" && accounts.length < 2 && (
          <p className="text-sm text-gray-500">振替には口座が2つ以上必要です。</p>
        )}

        <input
          type="number"
          min={1}
          step={1}
          aria-label="金額(円)"
          placeholder="金額(円)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="rounded border px-3 py-2"
          required
        />
        <input
          type="text"
          aria-label="摘要"
          placeholder="摘要"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded border px-3 py-2"
          required
        />
        <button
          type="submit"
          disabled={disabled}
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          登録
        </button>
      </form>
    </section>
  );
}

function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string;
  accounts: AccountSummary[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  return (
    <label className="flex flex-1 items-center gap-2 text-sm">
      <span className="shrink-0 text-gray-500">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 rounded border px-2 py-2"
        disabled={accounts.length === 0}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}({yen.format(a.balance)})
          </option>
        ))}
      </select>
    </label>
  );
}

function entryLabel(t: LedgerEntry) {
  if (t.transferId) {
    return t.type === "WITHDRAWAL"
      ? `振替出金 → ${t.counterpartAccountName}`
      : `振替入金 ← ${t.counterpartAccountName}`;
  }
  return t.type === "DEPOSIT" ? "入金" : "出金";
}

function History({
  accounts,
  transactions,
  busy,
  onReverse,
}: {
  accounts: AccountSummary[];
  transactions: LedgerEntry[];
  busy: boolean;
  onReverse: (t: LedgerEntry) => void;
}) {
  const [filter, setFilter] = useState<number | "all">("all");
  const rows = filter === "all" ? transactions : transactions.filter((t) => t.accountId === filter);

  return (
    <section className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b p-4">
        <h2 className="font-semibold">取引履歴</h2>
        <select
          aria-label="表示する口座"
          value={filter}
          onChange={(e) => setFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="rounded border px-2 py-1 text-sm"
        >
          <option value="all">すべての口座</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="divide-y">
        {rows.map((t) => {
          const reversible = t.reversedBy === null && t.reversalOf === null;
          return (
            <li key={t.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium">
                  <span className={t.type === "DEPOSIT" ? "text-green-700" : "text-red-700"}>
                    {t.type === "DEPOSIT" ? "+" : "−"}
                    {yen.format(t.amount)}
                  </span>{" "}
                  <span className="text-sm text-gray-600">{entryLabel(t)}</span>
                  {t.reversalOf && (
                    <span className="ml-2 text-xs text-gray-500">(#{t.reversalOf} の取消)</span>
                  )}
                </div>
                <div className="truncate text-sm text-gray-500">{t.description}</div>
                <div className="text-xs text-gray-400">
                  #{t.id} ・ {t.accountName} 残高 {yen.format(t.balanceAfter)} ・{" "}
                  {new Date(t.createdAt).toLocaleString("ja-JP")}
                </div>
              </div>
              {reversible && (
                <button
                  onClick={() => onReverse(t)}
                  disabled={busy}
                  className="shrink-0 rounded border px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {t.transferId ? "振替を取り消す" : "取り消す"}
                </button>
              )}
              {t.reversedBy !== null && (
                <span className="shrink-0 text-xs text-gray-400">取消済み</span>
              )}
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="p-4 text-sm text-gray-400">取引はまだありません</li>
        )}
      </ul>
    </section>
  );
}
