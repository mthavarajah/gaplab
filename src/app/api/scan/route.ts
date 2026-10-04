import { api, body } from "@/lib/server/http";
import { scanBatch } from "@/lib/server/services";
import { batchSchema } from "@/lib/domain/validation";
export const maxDuration = 60;
export async function POST(request: Request) {
  return api(async () => {
    const input = batchSchema.parse(await body(request));
    return scanBatch(input.symbols, input.asOf, undefined, input.mode);
  });
}
