import { NextRequest, NextResponse } from "next/server";
import { createTransaction, listTransactions, LedgerError } from "@/lib/ledger";

export async function GET() {
  const transactions = await listTransactions();
  return NextResponse.json({ transactions });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.type !== "DEPOSIT" && body.type !== "WITHDRAWAL") {
    return NextResponse.json(
      { error: "typeはDEPOSITかWITHDRAWALを指定してください。" },
      { status: 400 },
    );
  }

  try {
    const transaction = await createTransaction({
      type: body.type,
      amount: Number(body.amount),
      description: String(body.description ?? ""),
    });
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
