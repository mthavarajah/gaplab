import { getMarketCaps } from "@/lib/provider/market-caps";
import { api } from "@/lib/server/http";
export const maxDuration = 30;
export async function GET() {
  return api(getMarketCaps);
}
