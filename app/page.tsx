import { checkIntegrity, listTransactions } from "@/lib/ledger";
import { Ledger } from "./ledger";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [transactions, integrity] = await Promise.all([
    listTransactions(),
    checkIntegrity(),
  ]);

  return (
    <Ledger
      transactions={transactions.map((t) => ({
        ...t,
        createdAt: t.createdAt.toISOString(),
      }))}
      integrity={integrity}
    />
  );
}
