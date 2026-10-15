import { getShopDatabase } from "../../db.server";

/** Records that a human (merchant admin or Team Portal seat) viewed or exported
 * records containing customer personal data (name/email/phone). See /privacy. */
export async function logAccess(shopId: string, actor: string, action: string, recordCount: number) {
  if (recordCount <= 0) return;
  await getShopDatabase(shopId).accessLog.create({ data: { shopId, actor, action, recordCount } });
}
