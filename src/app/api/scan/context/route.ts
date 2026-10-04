import { api } from "@/lib/server/http";
import { getContext } from "@/lib/server/services";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET() {
  return api(() => getContext());
}
