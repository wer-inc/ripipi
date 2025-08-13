import Fastify from "fastify";
import cors from "@fastify/cors";
import { db, eq, and, gte, lt } from "./db";
import { reservations, members, notificationJobs, menus } from "./db/schema";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";

const app = Fastify({ logger: true });

// CORS設定
app.register(cors, {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true
});

// Health check endpoint
app.get("/health", async (req, reply) => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

// Auth: LINE IDトークン→アプリJWT
const JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));
app.post("/auth/line", async (req, reply) => {
  const body = z.object({ id_token: z.string(), store_id: z.string().uuid() }).parse(req.body);
  const { payload } = await jwtVerify(body.id_token, JWKS, {
    audience: process.env.LINE_CHANNEL_ID,
    issuer: "https://access.line.me",
  });
  const lineUserId = String(payload.sub);
  // 会員UPSERT
  await db.insert(members)
    .values({
      storeId: body.store_id,
      lineUserId: lineUserId
    })
    .onConflictDoNothing();
  const token = await new SignJWT({ sub: lineUserId, store_id: body.store_id })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(new TextEncoder().encode(process.env.APP_JWT_SECRET!));
  return reply.send({ token });
});

// 認証フック（管理画面からのアクセスは認証をスキップ）
app.addHook("onRequest", async (req, reply) => {
  if (req.routeOptions?.url?.startsWith("/auth")) return;
  if (req.routeOptions?.url === "/health") return;
  
  // 管理画面からのアクセスの場合は認証をスキップ（開発環境のみ）
  const origin = req.headers.origin || req.headers.referer || "";
  if (origin.includes("localhost:5174")) {
    (req as any).auth = { 
      sub: "admin", 
      store_id: process.env.STORE_ID || "27ce78c0-5bc1-402c-b667-dc7b2985e0b9" 
    };
    return;
  }
  
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
    // 先にメンバーIDを取得
    const member = await db.select({ memberId: members.memberId })
      .from(members)
      .where(and(
        eq(members.storeId, body.store_id),
        eq(members.lineUserId, auth.sub)
      ))
      .limit(1);
    
    if (!member[0]) {
      return reply.status(404).send({ error: "Member not found" });
    }

    // 予約を作成
    const r = await db.insert(reservations)
      .values({
        storeId: body.store_id,
        memberId: member[0].memberId,
        menuId: body.menu_id,
        staffId: body.staff_id || null,
        startAt: new Date(body.start_at),
        endAt: new Date(body.end_at ?? body.start_at),
        status: 'confirmed'
      })
      .returning();
    
    // 通知ジョブを作成（24時間前と2時間前）
    const reservationId = r[0].reservationId;
    const startAt = new Date(body.start_at);
    const reminder24h = new Date(startAt.getTime() - 24 * 60 * 60 * 1000);
    const reminder2h = new Date(startAt.getTime() - 2 * 60 * 60 * 1000);
    
    await db.insert(notificationJobs).values([
      {
        reservationId: reservationId,
        storeId: body.store_id,
        type: 'reminder_24h',
        scheduledAt: reminder24h
      },
      {
        reservationId: reservationId,
        storeId: body.store_id,
        type: 'reminder_2h',
        scheduledAt: reminder2h
      }
    ]);
    
    return reply.send(r);
  } catch (e: any) {
    if (String(e?.message).includes("no_overlap")) return reply.code(409).send({ error: "time_overlap" });
    throw e;
  }
});

app.get("/reservations", async (req, reply) => {
  const q = z.object({
    store_id: z.string().uuid(),
    from: z.string(),
    to: z.string()
  }).parse(req.query);
  
  const rows = await db.select()
    .from(reservations)
    .where(and(
      eq(reservations.storeId, q.store_id),
      gte(reservations.startAt, new Date(q.from)),
      lt(reservations.startAt, new Date(q.to))
    ))
    .orderBy(reservations.startAt);
  
  return reply.send(rows);
});

// メニュー一覧取得
app.get("/menus", async (req, reply) => {
  const q = z.object({
    store_id: z.string().uuid()
  }).parse(req.query);
  
  const rows = await db.select()
    .from(menus)
    .where(eq(menus.storeId, q.store_id))
    .orderBy(menus.name);
  
  return reply.send(rows);
});

// 予約ステータス更新
app.patch("/reservations/:id", async (req, reply) => {
  const params = z.object({
    id: z.string().uuid()
  }).parse(req.params);
  
  const body = z.object({
    status: z.enum(['confirmed', 'arrived', 'done', 'cancelled', 'no_show'])
  }).parse(req.body);
  
  await db.update(reservations)
    .set({ 
      status: body.status,
      updatedAt: new Date()
    })
    .where(eq(reservations.reservationId, params.id));
  
  return reply.send({ success: true });
});

// メニュー作成
app.post("/menus", async (req, reply) => {
  const body = z.object({
    store_id: z.string().uuid(),
    name: z.string(),
    durationMin: z.number(),
    price: z.number()
  }).parse(req.body);
  
  const result = await db.execute(/*sql*/`
    insert into menus (store_id, name, duration_min, price)
    values ('${body.store_id}', '${body.name}', ${body.durationMin}, ${body.price})
    returning menu_id, store_id, name, duration_min, price
  `);
  
  return reply.send(result[0]);
});

// メニュー更新
app.patch("/menus/:id", async (req, reply) => {
  const params = z.object({
    id: z.string().uuid()
  }).parse(req.params);
  
  const body = z.object({
    name: z.string().optional(),
    durationMin: z.number().optional(),
    price: z.number().optional()
  }).parse(req.body);
  
  const updates: any = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.durationMin !== undefined) updates.durationMin = body.durationMin;
  if (body.price !== undefined) updates.price = body.price;
  
  if (Object.keys(updates).length > 0) {
    await db.update(menus)
      .set(updates)
      .where(eq(menus.menuId, params.id));
  }
  
  return reply.send({ success: true });
});

// メニュー削除
app.delete("/menus/:id", async (req, reply) => {
  const params = z.object({
    id: z.string().uuid()
  }).parse(req.params);
  
  await db.delete(menus)
    .where(eq(menus.menuId, params.id));
  
  return reply.send({ success: true });
});

app.listen({ port: 8787, host: '0.0.0.0' });