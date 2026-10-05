import { createAccount, listAccounts } from "@/lib/ledger";
import { readBody, respond } from "@/lib/api";

export async function GET() {
  return respond(async () => ({ accounts: await listAccounts() }));
}

export async function POST(req: Request) {
  return respond(async () => {
    const body = await readBody(req);
    return { account: await createAccount(String(body.name ?? "")) };
  }, 201);
}
