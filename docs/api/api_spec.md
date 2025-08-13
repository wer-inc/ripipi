以下は、前回までの要件と方針（**REST / Fastify / フラット配列 / `undefined`禁止 / 二重予約防止 / Idempotency-Key** 等）を踏まえた **API側の詳細仕様書（v1.0 / REST）** です。
※本文は**実装に直結**する粒度で整理しています。

---

# 0. 全体方針

* **API 形態**：REST（JSON）／Base URL 例：`/v1`
* **認証**：Bearer JWT（`Authorization: Bearer <token>`）。権限は RBAC（`role` クレーム）。
* **テナント境界**：すべての書き込み系は `tenant_id` を必須。IDOR防止のためミドルウェアで検証。
* **日付時刻**：ISO8601（例：`2025-08-20T10:00:00+09:00`）。保存はUTC、返却はテナントTZ（既定：Asia/Tokyo）。
* **レスポンス形**：**フラットな配列 or フラットなオブジェクト**。`undefined`は返さない。`null`は可。
* **ページング**：**ヘッダ方式**

  * `X-Next-Cursor`: 次ページ取得用カーソル（存在時のみ付与）
  * `X-Total-Count`: 件数（必要なエンドポイントのみ）
  * 本文は配列のまま（ラッパーオブジェクトで包まない）
* **キャッシュ**：`GET /public/availability` は `Cache-Control`/`ETag` 対応（短TTL）。
* **レート制限**：`/v1/public/*` 5 req/min/IP（既定）。ヘッダ `X-RateLimit-*` を返却。
* **冪等性**：`POST /public/bookings` は **`Idempotency-Key` ヘッダ必須**（UUID推奨）。保存TTL 15分。
* **整合性**：在庫確保は **単一SQLの条件付きUPDATE** と **行ロック** で原子的に。複合リソースは順序ロック。
* **エラー形式（固定）**：

  ```json
  {
    "code": "timeslot_sold_out",
    "message": "Selected timeslot is no longer available.",
    "details": [{ "field": "timeslot_ids[0]", "reason": "no_capacity" }]
  }
  ```

**代表コード**：`validation_error`, `auth_required`, `permission_denied`, `not_found`, `conflict`,
`timeslot_sold_out`, `cancel_forbidden`, `payment_required`, `payment_failed`, `rate_limited`.

---

# 1. スキーマ（返却・受領の基本項目）

## 1.1 型規約

* 数値IDは 64bit 整数（クライアントは文字列扱いでも可）。
* 金額は最小通貨単位（JPYなら整数円）。小数は使わない。
* 文字列は UTF-8、空文字は使用可だが必須フィールドでは不可。

## 1.2 代表オブジェクト

### 予約（Booking）

```json
{
  "booking_id": 33321,
  "tenant_id": 1,
  "service_id": 12,
  "customer_id": 7777,
  "start_at": "2025-08-20T10:00:00+09:00",
  "end_at": "2025-08-20T11:00:00+09:00",
  "status": "confirmed",  // tentative|confirmed|cancelled|noshow|completed
  "total_jpy": 5000,
  "created_at": "2025-08-01T12:34:56+09:00",
  "updated_at": "2025-08-01T12:34:56+09:00"
}
```

### スロット（Timeslot：在庫行）

```json
{
  "timeslot_id": 98765,
  "tenant_id": 1,
  "service_id": 12,
  "resource_id": 55,
  "start_at": "2025-08-20T10:00:00+09:00",
  "end_at": "2025-08-20T11:00:00+09:00",
  "available_capacity": 2
}
```

---

# 2. パブリックAPI

## 2.1 空き照会：GET `/v1/public/availability`

**認証**：なし（公開） or テナント設定でトークン必須化可
**レート制限**：標準適用
**キャッシュ**：`Cache-Control: private, max-age=15`（既定）、`ETag` 返却

**Query**

* `tenant_id` (required, number)
* `service_id` (required, number)
* `from` (required, ISO8601)
* `to` (required, ISO8601)
* `resource_id` (optional, number) … 特定リソースに限定
* `granularity_min` (optional, number) … 表示粒度（既定15）

**200 Response（Body=配列）**

```json
[
  {
    "timeslot_id": 98765,
    "tenant_id": 1,
    "service_id": 12,
    "resource_id": 55,
    "start_at": "2025-08-20T10:00:00+09:00",
    "end_at": "2025-08-20T11:00:00+09:00",
    "available_capacity": 2
  }
]
```

**エラー**

* 400 `validation_error`（期間逆転/範囲過大 > 90日）
* 404 `not_found`（tenant/service 不存在）
* 429 `rate_limited`

**備考**

* ETag は（`tenant_id`,`service_id`,`from`,`to`）＋最新更新版から生成。
* 在庫は**最終確定ではない**（確定は予約時の減算で担保）。

---

## 2.2 予約作成：POST `/v1/public/bookings`

**認証**：なしでも可（パブリック予約想定）。テナント設定で必須化可。
**Idempotency**：**必須**（`Idempotency-Key` ヘッダ）。
**整合性**：DBで在庫を原子的に減算。

**Headers**

* `Idempotency-Key: <uuid>`

**Request Body**

```json
{
  "tenant_id": 1,
  "service_id": 12,
  "timeslot_ids": [98765],      // 複合リソース時は複数
  "customer": {
    "name": "山田太郎",
    "phone": "+81-90-0000-0000",
    "email": "taro@example.com",
    "line_user_id": "Uxxxxxxxx"
  },
  "notes": "",
  "consent_version": "2025-08-01",
  "policy_accept_ip": "203.0.113.10",
  "payment": {
    "mode": "setup_intent",     // "none" | "deposit" | "setup_intent"
    "max_penalty_jpy": 3000     // setup_intent時は必須
  }
}
```

**201 Response（Body=オブジェクト）**

```json
{
  "booking_id": 33321,
  "tenant_id": 1,
  "service_id": 12,
  "customer_id": 7777,
  "start_at": "2025-08-20T10:00:00+09:00",
  "end_at": "2025-08-20T11:00:00+09:00",
  "status": "confirmed",
  "total_jpy": 5000,
  "created_at": "2025-08-01T12:34:56+09:00"
}
```

**ステータス**

* 201 作成成功
* 202 受理（決済確認に時間がかかる場合）
* 400 `validation_error`（必須欠落・形式不正）
* 402 `payment_required` / `payment_failed`
* 404 `not_found`（timeslot/service 不存在）
* 409 `timeslot_sold_out`（在庫枯渇）
* 409 `conflict`（Idempotency-Key 重複だが**入力が不一致**）
* 429 `rate_limited`

**業務ルール**

* `timeslot_ids` の全てが確保可能な場合のみ成功（複合リソース）。
* **同一順序で `SELECT ... FOR UPDATE`** → すべて `available_capacity>0` 確認 → 全て減算 → 予約作成。
* 決済 `mode=setup_intent` の場合は Stripe SetupIntent 完了が必須（事前にClient側で完了させ、`customer` と紐づく）。

---

## 2.3 予約取得：GET `/v1/public/bookings/:booking_id`

**認証**：予約者本人確認が必要な場合はトークンまたは照合キー導入（テナント設定）
**200 Response**
（1.2「予約」参照）

**エラー**：403 `permission_denied`, 404 `not_found`

---

## 2.4 予約取消（本人）：DELETE `/v1/public/bookings/:booking_id`

**認証**：予約者本人 or 予約時に発行した取消トークン
**Query**

* `reason` (optional string) … `customer_request` 等

**200 Response**

```json
{ "booking_id": 33321, "status": "cancelled" }
```

**エラー**

* 403 `cancel_forbidden`（キャンセル期限超過：例 24h前）
* 404 `not_found`

---

# 3. 管理API（認証必須）

## 3.1 予約一覧：GET `/v1/bookings`

**Auth**：JWT（`role: staff|manager|owner|support`）
**Query**

* `tenant_id` (required)
* `from` / `to` (required, ISO8601)
* `status` (optional, enum)
* `service_id` / `resource_id` (optional)
* `cursor` (optional, string)
* `limit` (optional, 1–200, default 50)

**200 Response（配列）**＋`X-Next-Cursor`

```json
[
  {
    "booking_id": 33321,
    "tenant_id": 1,
    "service_id": 12,
    "customer_id": 7777,
    "start_at": "2025-08-20T10:00:00+09:00",
    "end_at": "2025-08-20T11:00:00+09:00",
    "status": "confirmed",
    "total_jpy": 5000,
    "created_at": "2025-08-01T12:34:56+09:00",
    "updated_at": "2025-08-01T12:34:56+09:00"
  }
]
```

---

## 3.2 予約更新：PATCH `/v1/bookings/:booking_id`

**Auth**：`staff|manager|owner|support`
**Headers**：`If-Match: "<etag>"`（**推奨**：楽観的排他）
**Body（任意項目のみ）**

```json
{
  "start_at": "2025-08-20T11:00:00+09:00",
  "end_at":   "2025-08-20T12:00:00+09:00",
  "status": "confirmed",
  "notes": "部屋変更"
}
```

**200 Response**：更新後の予約
**エラー**：

* 400 `validation_error`
* 409 `timeslot_sold_out`（時間変更で在庫不足）
* 412 前提条件失敗（ETag相違）
* 404 `not_found`

**備考**：時間変更は**旧在庫の返却＋新在庫の確保**を**同一トランザクション**で行う。

---

## 3.3 スロット生成：POST `/v1/timeslots/generate`

**Auth**：`manager|owner|support`
**Body**

```json
{
  "tenant_id": 1,
  "from": "2025-08-01",
  "to":   "2025-10-31",
  "granularity_min": 15,     // 5 or 15 を推奨
  "dry_run": false           // trueで作成件数のみ返す
}
```

**200 Response（dry\_run=false）**

```json
{ "generated": 12840, "updated": 320, "deleted": 12 }
```

**200 Response（dry\_run=true）**

```json
{ "will_generate": 12840, "will_update": 320, "will_delete": 12 }
```

**エラー**：400 期間過大（> 120日）

---

## 3.4 スロット検索：GET `/v1/timeslots`

**Auth**：`staff|manager|owner|support`
**Query**：`tenant_id, service_id, from, to, resource_id?, cursor?, limit?`
**200 Response（配列）**：1.2「スロット」参照＋`X-Next-Cursor`

---

## 3.5 顧客検索：GET `/v1/customers`

**Auth**：`staff|manager|owner|support`
**Query**：`tenant_id (req), q?, cursor?, limit?`
**200 Response（配列）**

```json
[
  { "customer_id": 7777, "tenant_id": 1, "name": "山田太郎", "phone": "+81-90-0000-0000", "email": "taro@example.com", "created_at": "2025-08-01T12:00:00+09:00" }
]
```

---

## 3.6 キャンセル（管理）：DELETE `/v1/bookings/:booking_id`

**Auth**：`staff|manager|owner|support`
**Query**：`reason` (optional)
**200 Response**

```json
{ "booking_id": 33321, "status": "cancelled" }
```

**エラー**：ポリシーにより `cancel_forbidden` を返す設定も可（無条件キャンセル可否をテナント設定で制御）。

---

# 4. 決済・Webhook

## 4.1 Stripe Webhook 受信：POST `/v1/webhooks/stripe`

**Auth**：署名検証（Stripe-Signature）
**冪等**：Webhook `event_id` をユニーク保存、重複受信は 200 で無処理。
**対応イベント（例）**

* `payment_intent.succeeded` → 予約支払い成功に更新
* `payment_intent.payment_failed` → `payment_failed`
* `setup_intent.succeeded` → カード保存成功

**200 Response**

```json
{ "received": true, "event_id": "evt_xxx" }
```

---

# 5. ヘルスチェック・運用

## 5.1 ヘルス：GET `/v1/health`

**200 Response**

```json
{ "status": "ok", "time": "2025-08-01T12:34:56Z" }
```

## 5.2 バージョン：GET `/v1/meta`

```json
{ "version": "1.0.0", "commit": "abc123", "deployed_at": "2025-08-01T10:00:00Z" }
```

---

# 6. セキュリティ / RBAC

* **ロール**：`owner`, `manager`, `staff`, `viewer`, `support`
* **境界**：`tenant_id` がJWTクレームと一致するリソースのみ操作可（`support`は別ルールで越境可）。
* **監査**：書き込み系は `audit_logs` に before/after（PIIマスク）を記録。
* **レート制限**：`/public/bookings` は強め（例 3 req/10min/IP）。

---

# 7. 競合制御（実装必須）

* **単一リソース確保**（SQL例）

  ```sql
  UPDATE timeslots
     SET available_capacity = available_capacity - 1
   WHERE id = $1 AND tenant_id = $2 AND available_capacity > 0
   RETURNING id, available_capacity;
  ```

  返却なし→`409 timeslot_sold_out`。

* **複合リソース**：対象 `timeslot_ids` を **同一定義順**で `FOR UPDATE` → 全て `available_capacity>0` → 全減算 → 成功。

* **ホットスロット**：`pg_advisory_xact_lock(hash(resource_id,start_at))` 併用可。

* **Idempotency**：同一 `Idempotency-Key` で**同一内容**なら**前回と同じ結果**を返す。入力が異なる場合は `409 conflict`。

---

# 8. バリデーション規約（抜粋）

* `from < to`、範囲の最大日数制限（空き：90日、スロット生成：120日）
* `timeslot_ids` は同一 `tenant_id`/`service_id`/時間連続性の整合性チェック
* キャンセル期限（`CANCEL_CUTOFF_MIN` 既定1440）超過は `cancel_forbidden`
* 支払いモードに応じた必須項目（例：`setup_intent` では `max_penalty_jpy` 必須）

---

# 9. エラーコード対照表

| HTTP | code                 | 典型原因                 |
| ---: | -------------------- | -------------------- |
|  400 | validation\_error    | 必須欠落、形式不正、範囲超過       |
|  401 | auth\_required       | 認証なし                 |
|  403 | permission\_denied   | 権限不足、他テナント資源         |
|  403 | cancel\_forbidden    | キャンセル期限超過            |
|  404 | not\_found           | ID不正、存在しない           |
|  409 | timeslot\_sold\_out  | 在庫枯渇（予約/時間変更）        |
|  409 | conflict             | Idempotency不一致、整合性衝突 |
|  412 | precondition\_failed | ETag不一致（If-Match）    |
|  429 | rate\_limited        | レート制限超過              |
|  402 | payment\_required    | 決済未完了                |
|  424 | payment\_failed      | 外部決済失敗               |

---

# 10. ヘッダ仕様（共通）

* `Authorization: Bearer <jwt>`
* `Idempotency-Key: <uuid>`（POST /public/bookings）
* `X-Request-Id: <uuid>`（要求→応答で相関）
* **ページング**：`X-Next-Cursor`, `X-Total-Count`
* **レート制限**：`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`
* **キャッシュ**：`ETag`, `Cache-Control`, `If-None-Match`

---

# 11. OpenAPI（抜粋サンプル / 構造）

```yaml
openapi: 3.1.0
info:
  title: Reservation API
  version: 1.0.0
paths:
  /v1/public/availability:
    get:
      parameters:
        - in: query; name: tenant_id; required: true; schema: { type: integer }
        - in: query; name: service_id; required: true; schema: { type: integer }
        - in: query; name: from; required: true; schema: { type: string, format: date-time }
        - in: query; name: to; required: true; schema: { type: string, format: date-time }
      responses:
        '200':
          description: OK
          headers:
            ETag: { schema: { type: string } }
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Timeslot'
  /v1/public/bookings:
    post:
      parameters:
        - in: header; name: Idempotency-Key; required: true; schema: { type: string }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/CreateBookingRequest'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Booking' }
components:
  schemas:
    Timeslot:
      type: object
      additionalProperties: false
      properties:
        timeslot_id: { type: integer }
        tenant_id: { type: integer }
        service_id: { type: integer }
        resource_id: { type: integer }
        start_at: { type: string, format: date-time }
        end_at:   { type: string, format: date-time }
        available_capacity: { type: integer, minimum: 0 }
      required: [timeslot_id, tenant_id, service_id, resource_id, start_at, end_at, available_capacity]
    Booking:
      type: object
      additionalProperties: false
      properties:
        booking_id: { type: integer }
        tenant_id: { type: integer }
        service_id: { type: integer }
        customer_id: { type: integer }
        start_at: { type: string, format: date-time }
        end_at:   { type: string, format: date-time }
        status: { type: string, enum: [tentative, confirmed, cancelled, noshow, completed] }
        total_jpy: { type: integer }
        created_at: { type: string, format: date-time }
        updated_at: { type: string, format: date-time }
      required: [booking_id, tenant_id, service_id, customer_id, start_at, end_at, status, total_jpy]
    CreateBookingRequest:
      type: object
      additionalProperties: false
      properties:
        tenant_id: { type: integer }
        service_id: { type: integer }
        timeslot_ids:
          type: array
          items: { type: integer }
          minItems: 1
        customer:
          type: object
          additionalProperties: false
          properties:
            name: { type: string }
            phone: { type: string }
            email: { type: string, format: email }
            line_user_id: { type: string }
          required: [name]
        notes: { type: string }
        consent_version: { type: string }
        policy_accept_ip: { type: string }
        payment:
          type: object
          additionalProperties: false
          properties:
            mode: { type: string, enum: [none, deposit, setup_intent] }
            max_penalty_jpy: { type: integer }
      required: [tenant_id, service_id, timeslot_ids, customer, consent_version]
```

---

# 12. テスト観点（E2E必須）

* **並列POST 100件** → 同一スロットで成功=1件、他は `409 timeslot_sold_out`
* **Idempotency**：同一キー＋同一内容→**同一応答**、内容差異→`409 conflict`
* **キャンセル期限**：期限越え→`403 cancel_forbidden`
* **Webhook冪等**：同一 `event_id` 5回送信→1回のみ処理
* **ETag**：`If-Match` 相違→`412 precondition_failed`
* **レート制限**：閾値超過→`429 rate_limited` + `Retry-After`

---

# 13. 今後の拡張（ガイドライン）

* **BFF(GraphQL)**：管理画面の集約読み取り専用に追加可（外部公開はREST継続）。
* **内部gRPC**：スロット生成・ノーショー判定ワーカーを分離した際の内部RPCに利用。
* **ウェイティングリスト**：`/v1/waitlist` 追加（繰上げ時は `POST /v1/public/bookings` を内部実行）。

---

必要であれば、この仕様に完全準拠した **Fastify ルーティング雛形（TypeScript）**、**Zod/TypeBox スキーマ**、**テストコード（並列競合/Idempotency/ETag）** を一式でお出しします。どこから着手しますか？（例：`/v1/public/bookings` から）
