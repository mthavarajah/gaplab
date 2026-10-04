import { api, body } from "@/lib/server/http";
import { batchSchema } from "@/lib/domain/validation";
import { premarketMetrics } from "@/lib/server/services";
export const maxDuration = 60;
export async function POST(request: Request) {
  return api(async () => {
    const input = batchSchema.parse(await body(request));
    return premarketMetrics(input.symbols, input.asOf);
  });
}
