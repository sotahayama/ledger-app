import { checkIntegrity } from "@/lib/ledger";
import { respond } from "@/lib/api";

export async function GET() {
  return respond(checkIntegrity);
}
