import { db } from "./db";
import ky from "ky"; // Messaging API呼び出し用（実際は公式SDKでもOK）
import cron from "node-cron";

cron.schedule("* * * * *", async () => {
  const now = new Date();
  const rows = await db.execute(/*sql*/`
    update notification_jobs
    set status='sent'
    where status='scheduled' and scheduled_at <= now()
    returning job_id, type, reservation_id, store_id
  `);
  for (const r of rows as any[]) {
    // ここで LINE Push を実行（Messaging API のチャネル/トークンが必要）
    // await ky.post("https://api.line.me/v2/bot/message/push", { headers: {...}, json: {...} });
    console.log("sent", r.job_id, r.type);
  }
});