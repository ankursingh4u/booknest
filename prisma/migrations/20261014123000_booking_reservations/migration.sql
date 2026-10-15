-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'NEEDS_REVIEW';

-- DropIndex
DROP INDEX "Booking_staffId_startAt_status_key";

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "uninstalledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "currentPeriodStart" TIMESTAMP(3),
ADD COLUMN     "seatMeterActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shopifyShopGid" TEXT;

-- AlterTable
ALTER TABLE "TeamSeat" ADD COLUMN     "billingConsentAt" TIMESTAMP(3),
ADD COLUMN     "inviteExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT,
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN     "googleSyncError" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "customerCancelCutoffHours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "customerRescheduleCutoffHours" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "slotIntervalMin" INTEGER;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "googleEventCalendarId" TEXT,
ADD COLUMN     "googleEventStaffId" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "orderLineId" TEXT,
ADD COLUMN     "paidCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "priceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reservationId" TEXT;

-- AlterTable
ALTER TABLE "IntakeQuestion" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "AdditionalHours" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "staffId" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdditionalHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "dueCents" INTEGER NOT NULL DEFAULT 0,
    "depositType" "DepositType" NOT NULL DEFAULT 'NONE',
    "answers" JSONB NOT NULL DEFAULT '[]',
    "checkoutId" TEXT,
    "checkoutUrl" TEXT,
    "checkoutStartedAt" TIMESTAMP(3),
    "currency" TEXT NOT NULL,
    "variantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationTask" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "expectedStartAt" TIMESTAMP(3) NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleOAuthState" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "GoogleOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeatUsage" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "seatId" TEXT NOT NULL,
    "shopifyShopGid" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "SeatUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdditionalHours_shopId_locationId_startAt_idx" ON "AdditionalHours"("shopId", "locationId", "startAt");

-- CreateIndex
CREATE INDEX "AdditionalHours_shopId_staffId_startAt_idx" ON "AdditionalHours"("shopId", "staffId", "startAt");

-- CreateIndex
CREATE INDEX "Reservation_shopId_staffId_expiresAt_idx" ON "Reservation"("shopId", "staffId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_shopId_idempotencyKey_key" ON "Reservation"("shopId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "WebhookReceipt_processedAt_createdAt_idx" ON "WebhookReceipt"("processedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookReceipt_shopId_externalId_key" ON "WebhookReceipt"("shopId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationTask_dedupeKey_key" ON "NotificationTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationTask_completedAt_runAt_idx" ON "NotificationTask"("completedAt", "runAt");

-- CreateIndex
CREATE INDEX "GoogleOAuthState_expiresAt_idx" ON "GoogleOAuthState"("expiresAt");

-- CreateIndex
CREATE INDEX "SeatUsage_submittedAt_attempts_idx" ON "SeatUsage"("submittedAt", "attempts");

-- CreateIndex
CREATE UNIQUE INDEX "SeatUsage_shopId_seatId_periodStart_key" ON "SeatUsage"("shopId", "seatId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeat_inviteTokenHash_key" ON "TeamSeat"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reservationId_key" ON "Booking"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_shopId_idempotencyKey_key" ON "Booking"("shopId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_shopId_orderLineId_key" ON "Booking"("shopId", "orderLineId");

-- AddForeignKey
ALTER TABLE "AdditionalHours" ADD CONSTRAINT "AdditionalHours_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalHours" ADD CONSTRAINT "AdditionalHours_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdditionalHours" ADD CONSTRAINT "AdditionalHours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationTask" ADD CONSTRAINT "NotificationTask_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleOAuthState" ADD CONSTRAINT "GoogleOAuthState_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleOAuthState" ADD CONSTRAINT "GoogleOAuthState_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatUsage" ADD CONSTRAINT "SeatUsage_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatUsage" ADD CONSTRAINT "SeatUsage_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "TeamSeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Application invariants also enforced at the database boundary.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_positive_quantity" CHECK ("quantity" > 0), ADD CONSTRAINT "Booking_ordered_time" CHECK ("endAt" > "startAt");
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_positive_quantity" CHECK ("quantity" > 0), ADD CONSTRAINT "Reservation_ordered_time" CHECK ("endAt" > "startAt");
ALTER TABLE "AdditionalHours" ADD CONSTRAINT "AdditionalHours_ordered_time" CHECK ("endAt" > "startAt");
