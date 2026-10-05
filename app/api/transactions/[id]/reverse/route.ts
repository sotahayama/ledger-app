import { reverseTransaction } from "@/lib/ledger";
import { respond } from "@/lib/api";

export async function POST(
  _req: Request,
  ctx: RouteContext<"/api/transactions/[id]/reverse">,
) {
  const { id } = await ctx.params;
  return respond(() => reverseTransaction(Number(id)), 201);
}
