import Fastify from "fastify";
import { db } from "./db";
import { reservations, members } from "./db/schema";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const app = Fastify({ logger: true });

// Auth: LINE IDトークン→アプリJWT
const JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));
app.post("/auth/line", async (req, reply) => {
  const body = z.object({ id_token: z.string(), store_id: z.string().uuid() }).parse(req.body);
  const { payload } = await jwtVerify(body.id_token, JWKS, {
    audience: process.env.LINE_CHANNEL_ID,
    issuer: "https://access.line.me",
  });
  const lineUserId = String(payload.sub);
  // 会員UPSERT（簡略）
  await db.execute(`
    insert into members (store_id, line_user_id) 
    values ('${body.store_id}', '${lineUserId}')
    on conflict (store_id, line_user_id) do nothing;
  `);
  const token = await new SignJWT({ sub: lineUserId, store_id: body.store_id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.APP_JWT_SECRET!));
  return reply.send({ token });
});

// 認証フック
app.addHook("onRequest", async (req, reply) => {
  if (req.routeOptions?.url?.startsWith("/auth")) return;
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) return reply.code(401).send();
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.APP_JWT_SECRET!), {
      issuer: "your-app", audience: "liff", algorithms: ["HS256"], // 署名と発行者は合わせる
    }).catch(() => jwtVerify(token, new TextEncoder().encode(process.env.APP_JWT_SECRET!)));
    (req as any).auth = payload;
  } catch {
    return reply.code(401).send();
  }
});

// 予約作成（Idempotencyは簡略化）
app.post("/reservations", async (req, reply) => {
  const auth = (req as any).auth as { store_id: string; sub: string };
  const body = z.object({
    store_id: z.string().uuid(),
    member_id: z.string().uuid().optional(), // 無ければ sub から引く実装に
    menu_id: z.string().uuid(),
    staff_id: z.string().uuid().optional(),
    start_at: z.string(),
    end_at: z.string().optional(),
  }).parse(req.body);

  // … duration から end_at を算出するなど

  try {
    const r = await db.execute(/*sql*/`
      insert into reservations (store_id, member_id, menu_id, staff_id, start_at, end_at, status)
      values ('${body.store_id}', (select member_id from members where store_id='${body.store_id}' and line_user_id='${auth.sub}' limit 1),
              '${body.menu_id}', ${body.staff_id ? `'${body.staff_id}'` : 'null'},
              '${body.start_at}', '${body.end_at ?? body.start_at}', 'confirmed')
      returning reservation_id, store_id, member_id, menu_id, staff_id, start_at, end_at, status
    `);
    
    // 通知ジョブを作成（24時間前と2時間前）
    const reservationId = (r as any)[0].reservation_id;
    const startAt = new Date(body.start_at);
    const reminder24h = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
    const reminder2h = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);
    
    await db.execute(/*sql*/`
      insert into notification_jobs (reservation_id, store_id, type, scheduled_at)
      values 
        ('${reservationId}', '${body.store_id}', 'reminder_24h', '${reminder24h.toISOString()}'),
        ('${reservationId}', '${body.store_id}', 'reminder_2h', '${reminder2h.toISOString()}')
    `);
    
    return reply.send(r);
  } catch (e: any) {
    if (String(e?.message).includes("no_overlap")) return reply.code(409).send({ error: "time_overlap" });
    throw e;
  }
});

app.get("/reservations", async (req, reply) => {
  const q = req.query as any;
  const rows = await db.execute(/*sql*/`
    select reservation_id, store_id, member_id, menu_id, staff_id, start_at, end_at, status
    from reservations
    where store_id='${q.store_id}'
      and start_at >= '${q.from}' and start_at < '${q.to}'
    order by start_at asc
  `);
  return reply.send(rows); // ← フラット配列
});

app.listen({ port: 8787 });