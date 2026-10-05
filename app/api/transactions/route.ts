import { createTransaction, listTransactions, LedgerError } from "@/lib/ledger";
import { readBody, respond } from "@/lib/api";

export async function GET() {
  return respond(async () => ({ transactions: await listTransactions() }));
}

export async function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    if (body.type !== "DEPOSIT" && body.type !== "WITHDRAWAL") {
      throw new LedgerError("typeはDEPOSITかWITHDRAWALを指定してください。");
    }
    const transaction = await createTransaction({
      accountId: Number(body.accountId),
      type: body.type,
      amount: Number(body.amount),
      description: String(body.description ?? ""),
    });
    return { transaction };
  }, 201);
}
