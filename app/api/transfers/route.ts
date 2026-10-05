import { transfer } from "@/lib/ledger";
import { readBody, respond } from "@/lib/api";

export async function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    return transfer({
      fromAccountId: Number(body.fromAccountId),
      toAccountId: Number(body.toAccountId),
      amount: Number(body.amount),
      description: String(body.description ?? ""),
    });
  }, 201);
}
