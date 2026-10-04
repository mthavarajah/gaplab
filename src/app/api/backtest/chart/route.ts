import { api, body } from "@/lib/server/http";
import { eventChart } from "@/lib/server/services";
import { eventChartSchema } from "@/lib/domain/validation";
export const maxDuration = 60;
export async function POST(request: Request) {
  return api(async () =>
    eventChart(eventChartSchema.parse(await body(request))),
  );
}
