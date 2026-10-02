import { NextResponse } from "next/server";
import { reverseTransaction, LedgerError } from "@/lib/ledger";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const transaction = await reverseTransaction(Number(id));
    return NextResponse.json({ transaction }, { status: 201 });
  } catch (e) {
    if (e instanceof LedgerError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
