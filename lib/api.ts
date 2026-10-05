import { NextResponse } from "next/server";
import { LedgerError } from "@/lib/ledger";

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    if (body && typeof body === "object") return body;
  } catch {}
  throw new LedgerError("リクエストの形式が正しくありません。");
}

export async function respond(fn: () => Promise<unknown>, status = 200) {
  try {
    return NextResponse.json(await fn(), { status });
  } catch (e) {
    if (e instanceof LedgerError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
