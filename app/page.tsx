import { checkIntegrity, listAccounts, listTransactions } from "@/lib/ledger";
import { Ledger } from "./ledger";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [accounts, transactions, integrity] = await Promise.all([
    listAccounts(),
    listTransactions(),
    checkIntegrity(),
  ]);

  return (
    <Ledger accounts={accounts} transactions={transactions} integrity={integrity} />
  );
}
