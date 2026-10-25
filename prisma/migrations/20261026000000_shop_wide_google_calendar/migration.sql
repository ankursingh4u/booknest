-- Shop-wide Google Calendar: one connection per shop, every booking syncs to it.
ALTER TABLE "Shop" ADD COLUMN "googleRefreshToken" TEXT;
ALTER TABLE "Shop" ADD COLUMN "googleCalendarId" TEXT;
ALTER TABLE "Shop" ADD COLUMN "googleSyncError" TEXT;

-- Carry the existing per-Availability connection up to the shop (newest connected wins),
-- so already-connected merchants do not have to reconnect.
UPDATE "Shop" s
SET "googleRefreshToken" = sm."googleRefreshToken",
    "googleCalendarId"   = sm."googleCalendarId"
FROM (
  SELECT DISTINCT ON ("shopId") "shopId", "googleRefreshToken", "googleCalendarId"
  FROM "StaffMember"
  WHERE "googleRefreshToken" IS NOT NULL AND "googleCalendarId" IS NOT NULL
  ORDER BY "shopId", "createdAt" DESC
) sm
WHERE sm."shopId" = s."id";

ALTER TABLE "StaffMember" DROP COLUMN "googleRefreshToken";
ALTER TABLE "StaffMember" DROP COLUMN "googleCalendarId";
ALTER TABLE "StaffMember" DROP COLUMN "googleSyncError";

ALTER TABLE "Booking" DROP COLUMN "googleEventStaffId";

ALTER TABLE "GoogleOAuthState" ALTER COLUMN "staffId" DROP NOT NULL;
