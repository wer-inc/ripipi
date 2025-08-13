import { db } from "./db";
import { stores, menus, members, staff } from "./db/schema";
import dotenv from "dotenv";

dotenv.config();

async function seed() {
  console.log("🌱 Seeding database...");

  try {
    // 1. 店舗データ
    const [store] = await db.insert(stores).values({
      name: "Ripipi美容室 渋谷店",
      timezone: "Asia/Tokyo",
    }).returning();
    
    console.log("✅ Store created:", store.storeId);

    // 2. メニューデータ
    const menuData = [
      { name: "カット", durationMin: 30, price: 3500 },
      { name: "カット + カラー", durationMin: 90, price: 8000 },
      { name: "パーマ", durationMin: 120, price: 10000 },
      { name: "トリートメント", durationMin: 45, price: 4500 },
      { name: "ヘッドスパ", durationMin: 60, price: 5000 },
    ];

    const insertedMenus = await db.insert(menus).values(
      menuData.map(menu => ({
        storeId: store.storeId,
        name: menu.name,
        durationMin: menu.durationMin,
      }))
    ).returning();

    console.log(`✅ ${insertedMenus.length} menus created`);

    // 3. スタッフデータ
    const staffData = [
      { name: "田中美香", role: "stylist" },
      { name: "山本健太", role: "stylist" },
      { name: "佐々木愛", role: "stylist" },
      { name: "鈴木店長", role: "manager" },
    ];

    const insertedStaff = await db.insert(staff).values(
      staffData.map(s => ({
        storeId: store.storeId,
        name: s.name,
        role: s.role,
      }))
    ).returning();

    console.log(`✅ ${insertedStaff.length} staff created`);

    // 4. 会員データ（テスト用）
    const testMembers = [
      { lineUserId: "U1234567890abcdef", displayName: "山田太郎" },
      { lineUserId: "U2345678901abcdef", displayName: "鈴木花子" },
      { lineUserId: "U3456789012abcdef", displayName: "佐藤次郎" },
    ];

    const insertedMembers = await db.insert(members).values(
      testMembers.map(member => ({
        storeId: store.storeId,
        lineUserId: member.lineUserId,
        displayName: member.displayName,
      }))
    ).returning();

    console.log(`✅ ${insertedMembers.length} test members created`);

    console.log("\n🎉 Seeding completed successfully!");
    console.log("\n📝 Store ID for .env file:");
    console.log(`VITE_STORE_ID=${store.storeId}`);

  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  }
}

// 実行
seed().then(() => process.exit(0));