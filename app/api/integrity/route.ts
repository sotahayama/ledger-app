import { NextResponse } from "next/server";
import { checkIntegrity } from "@/lib/ledger";

export async function GET() {
  const result = await checkIntegrity();
  return NextResponse.json(result);
}
