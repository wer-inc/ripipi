import Fastify from "fastify";
import cors from "@fastify/cors";
import { db, eq, and, gte, lt } from "./db";
import { reservations, members, notificationJobs, menus } from "./db/schema";
import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { rateLimitMiddleware } from "./lib/rate-limit";
import { ApiError, Errors, sendErrorResponse } from "./lib/errors";
import { observabilityMiddleware, formatPrometheusMetrics, getHealthStatus } from "./lib/observability";

const app = Fastify({ logger: true });

// CORS設定
app.register(cors, {
  origin: process.env.NODE_ENV === "production" ? process.env.ALLOWED_ORIGINS?.split(",") : true,
  credentials: true
});

// ヘルスチェック（バージョニングなし）
app.get("/health", async (req, reply) => {
  const detailed = req.query.detailed === 'true';
  if (detailed) {
    return await getHealthStatus();
  }
  return { status: "ok", timestamp: new Date().toISOString() };
});

// メトリクスエンドポイント（Prometheus形式）
app.get("/metrics", async (req, reply) => {
  reply.type('text/plain');
  return formatPrometheusMetrics();
});

// 可観測性フック
app.addHook("onRequest", observabilityMiddleware);

// レート制限フック
app.addHook("onRequest", rateLimitMiddleware);

// 認証フック - セキュリティ強化版
app.addHook("onRequest", async (req, reply) => {
  // 認証不要なエンドポイントはスキップ
  if (req.routeOptions?.url?.includes("/auth")) return;
  if (req.routeOptions?.url === "/health") return;
  
  // 認証バイパスを削除 - 全環境で認証を必須化
  const hdr = req.headers.authorization || "";
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : null;
  if (!token) {
    return sendErrorResponse(reply, Errors.unauthorized());
  }
  
  try {
    // 厳密なJWT検証 - iss/audの不一致は拒否
    const { payload } = await jwtVerify(
      token, 
      new TextEncoder().encode(process.env.APP_JWT_SECRET!), 
      {
        issuer: "your-app",
        audience: "liff",
        algorithms: ["HS256"]
      }
    );
    (req as any).auth = payload;
  } catch (error) {
    return sendErrorResponse(reply, Errors.invalidToken());
  }
});

// API v1 - バージョニングプレフィックス付き
app.register((app, opts, next) => {
  
  // Auth: LINE IDトークン→アプリJWT
  const JWKS = createRemoteJWKSet(new URL("https://api.line.me/oauth2/v2.1/certs"));
  app.post("/auth/line", async (req, reply) => {
    const body = z.object({ id_token: z.string(), store_id: z.string().uuid() }).parse(req.body);
    const { payload } = await jwtVerify(body.id_token, JWKS, {
      audience: process.env.LINE_CHANNEL_ID,
      issuer: "https://access.line.me",
    });
    const jwt = await new SignJWT({ sub: payload.sub, store_id: body.store_id })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setIssuer("your-app")
      .setAudience("liff")
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(process.env.APP_JWT_SECRET!));
    return reply.send({ token: jwt });
  });
  
  // 予約作成（Idempotency対応）
  app.post("/reservations", async (req, reply) => {
    const auth = (req as any).auth;
    
    // Idempotencyキーのチェック
    const idempotencyKey = req.headers['idempotency-key'] as string;
    if (idempotencyKey) {
      // 既存の予約をチェック
      const existing = await db.select()
        .from(reservations)
        .where(eq(reservations.idempotencyKey, idempotencyKey))
        .limit(1);
      
      if (existing.length > 0) {
        return reply.status(200).send(existing[0]);
      }
    }
    
    const body = z.object({
      store_id: z.string().uuid(),
      menu_id: z.string().uuid(),
      staff_id: z.string().uuid().optional(),
      start_at: z.string(),
      end_at: z.string().optional()
    }).parse(req.body);

    try {
      // メンバーIDを取得
      const member = await db.select({ memberId: members.memberId })
        .from(members)
        .where(and(
          eq(members.storeId, body.store_id),
          eq(members.lineUserId, auth.sub)
        ))
        .limit(1);
      
      if (!member[0]) {
        return sendErrorResponse(reply, Errors.notFound('Member'));
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
          status: 'confirmed',
          idempotencyKey: idempotencyKey || undefined
        })
        .returning();
      
      // 通知ジョブを作成
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
      if (String(e?.message).includes("no_overlap")) {
        return sendErrorResponse(reply, Errors.conflict('予約時間が重複しています', { error: 'time_overlap' }));
      }
      return sendErrorResponse(reply, Errors.internal('予約の作成に失敗しました'));
    }
  });

  // 予約一覧取得（ページング対応）
  app.get("/reservations", async (req, reply) => {
    const q = z.object({
      store_id: z.string().uuid(),
      from: z.string(),
      to: z.string(),
      limit: z.number().min(1).max(100).default(20).optional(),
      offset: z.number().min(0).default(0).optional(),
      cursor: z.string().optional()
    }).parse(req.query);
    
    const auth = (req as any).auth;
    const limit = q.limit || 20;
    const offset = q.offset || 0;
    
    // 基本条件
    const baseConditions = [
      gte(reservations.startAt, new Date(q.from)),
      lt(reservations.startAt, new Date(q.to))
    ];
    
    // カーソルベースのページング
    if (q.cursor) {
      baseConditions.push(gte(reservations.reservationId, q.cursor));
    }
    
    // 認可チェック
    let conditions;
    if (auth.role === "admin" && auth.store_id === q.store_id) {
      conditions = and(
        eq(reservations.storeId, q.store_id),
        ...baseConditions
      );
    } else {
      conditions = and(
        eq(reservations.memberId, auth.sub),
        eq(reservations.storeId, q.store_id),
        ...baseConditions
      );
    }
    
    // データ取得
    const rows = await db.select()
      .from(reservations)
      .where(conditions)
      .orderBy(reservations.startAt)
      .limit(limit + 1)  // 次のページがあるか確認用
      .offset(offset);
    
    // ページング情報
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, -1) : rows;
    const nextCursor = hasMore ? data[data.length - 1].reservationId : null;
    
    return reply.send({
      data,
      pagination: {
        limit,
        offset,
        hasMore,
        nextCursor,
        total: null  // カウントクエリは重いため省略
      }
    });
  });

  // 予約状態更新
  app.patch("/reservations/:id", async (req, reply) => {
    const params = z.object({
      id: z.string().uuid()
    }).parse(req.params);
    
    const body = z.object({
      status: z.enum(['confirmed', 'cancelled', 'completed'])
    }).parse(req.body);
    
    await db.update(reservations)
      .set({ status: body.status, updatedAt: new Date() })
      .where(eq(reservations.reservationId, params.id));
    
    return reply.send({ success: true });
  });

  // メニュー一覧取得（ページング対応）
  app.get("/menus", async (req, reply) => {
    const query = z.object({
      store_id: z.string().uuid(),
      limit: z.number().min(1).max(100).default(20).optional(),
      offset: z.number().min(0).default(0).optional()
    }).parse(req.query);
    
    const limit = query.limit || 20;
    const offset = query.offset || 0;
    
    const rows = await db.select()
      .from(menus)
      .where(eq(menus.storeId, query.store_id))
      .limit(limit + 1)
      .offset(offset);
    
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, -1) : rows;
    
    return reply.send({
      data,
      pagination: {
        limit,
        offset,
        hasMore
      }
    });
  });

  // メニュー作成
  app.post("/menus", async (req, reply) => {
    const body = z.object({
      store_id: z.string().uuid(),
      name: z.string(),
      durationMin: z.number(),
      price: z.number()
    }).parse(req.body);
    
    // SQLインジェクション対策: パラメータ化クエリを使用
    const [newMenu] = await db.insert(menus)
      .values({
        storeId: body.store_id,
        name: body.name,
        durationMin: body.durationMin,
        price: body.price
      })
      .returning();
    
    return reply.send(newMenu);
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
  
  next();
}, { prefix: '/v1' });

app.listen({ port: 8787, host: '0.0.0.0' });