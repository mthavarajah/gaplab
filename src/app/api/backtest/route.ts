import { api, body } from "@/lib/server/http";
import { backtest } from "@/lib/server/services";
import { backtestSchema } from "@/lib/domain/validation";
export const maxDuration = 60;
export async function POST(request: Request) {
  return api(async () => backtest(backtestSchema.parse(await body(request))));
}
