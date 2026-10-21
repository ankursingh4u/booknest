import { describe, expect, it } from "vitest";
import { locationSchema, staffSchema, serviceSchema, ruleSchema, ruleUpdateSchema, blackoutSchema, additionalHoursSchema } from "./schemas";
const service = { title: "Yoga", slug: "yoga", locationId: "loc", durationMin: "60", capacity: "5",
  bufferBefore: "0", bufferAfter: "0", price: "12.50", depositType: "NONE", depositValue: "0",
  minNoticeHours: "1", maxAdvanceDays: "60", variantId: "123", staffIds: ["staff"] };
describe("merchant input validation", () => {
  it("normalizes money and Shopify variant identifiers", () => {
    const parsed = serviceSchema.parse(service);
    expect(parsed.priceCents).toBe(1250);
    expect(parsed.variantId).toBe("gid://shopify/ProductVariant/123");
  });
  it("rejects fractional cents", () => { expect(serviceSchema.safeParse({ ...service, price: "0.001" }).success).toBe(false); });
  it("requires a product variant for paid checkout", () => { expect(serviceSchema.safeParse({ ...service, variantId: "" }).success).toBe(false); });
  it("rejects deposits exceeding the service price", () => {
    expect(serviceSchema.safeParse({ ...service, depositType: "FIXED", depositValue: "20" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...service, depositType: "PERCENT", depositValue: "101" }).success).toBe(false);
  });
  it("requires at least one assigned Availability", () => { expect(serviceSchema.safeParse({ ...service, staffIds: [] }).success).toBe(false); });
  it("uses valid IANA timezones", () => {
    expect(locationSchema.safeParse({ name: "Studio", timezone: "Asia/Kolkata" }).success).toBe(true);
    expect(locationSchema.safeParse({ name: "Studio", timezone: "Invalid/Zone" }).success).toBe(false);
  });
  it("rejects executable Contact Links", () => {
    expect(staffSchema.safeParse({ firstName: "A", lastName: "B", email: "a@example.com", timezone: "UTC", contactLink: "javascript:alert(1)", locationIds: ["loc"] }).success).toBe(false);
  });
  it("accepts an overnight rule but rejects equal endpoints", () => {
    expect(ruleSchema.safeParse({ staffId: "a", weekday: "1", startTime: "23:00", endTime: "02:00", timezone: "UTC" }).success).toBe(true);
    expect(ruleSchema.safeParse({ staffId: "a", weekday: "1", startTime: "09:00", endTime: "09:00", timezone: "UTC" }).success).toBe(false);
  });
  it("requires exactly one schedule owner", () => {
    expect(ruleSchema.safeParse({ staffId: "a", serviceId: "b", weekday: "1", startTime: "09:00", endTime: "17:00", timezone: "UTC" }).success).toBe(false);
  });
  it("updates only the time range of an existing rule", () => {
    expect(ruleUpdateSchema.safeParse({ id: "rule-a", startTime: "09:00", endTime: "17:00" }).success).toBe(true);
    expect(ruleUpdateSchema.safeParse({ id: "rule-a", startTime: "09:00", endTime: "09:00" }).success).toBe(false);
  });
  it("rejects a nonexistent blackout time during a spring transition", () => {
    expect(blackoutSchema.safeParse({ startLocal: "2026-03-08T02:30", endLocal: "2026-03-08T04:00", timezone: "America/New_York" }).success).toBe(false);
  });
});

describe("customer booking policy inputs", () => {
  it("parses separate slot spacing and customer deadlines", () => {
    const parsed = serviceSchema.parse({ ...service, slotIntervalMin: "15", customerCancelCutoffHours: "24", customerRescheduleCutoffHours: "12" });
    expect(parsed.slotIntervalMin).toBe(15);
    expect(parsed.customerCancelCutoffHours).toBe(24);
    expect(parsed.customerRescheduleCutoffHours).toBe(12);
  });
  it("defaults existing services to duration spacing and no advance cutoff", () => {
    expect(serviceSchema.parse(service)).toMatchObject({ slotIntervalMin: null, customerCancelCutoffHours: 0, customerRescheduleCutoffHours: 0 });
    expect(serviceSchema.parse({ ...service, slotIntervalMin: "" }).slotIntervalMin).toBeNull();
  });
  it("rejects fractional or excessive scheduling policy values", () => {
    for (const interval of ["0", "0.5", "1441"]) expect(serviceSchema.safeParse({ ...service, slotIntervalMin: interval }).success).toBe(false);
    for (const cutoff of ["-1", "0.5", "8761"]) {
      expect(serviceSchema.safeParse({ ...service, customerCancelCutoffHours: cutoff }).success).toBe(false);
      expect(serviceSchema.safeParse({ ...service, customerRescheduleCutoffHours: cutoff }).success).toBe(false);
    }
  });
});

describe("product setup choice", () => {
  it("accepts a paid service awaiting a new Shopify product", () => {
    expect(serviceSchema.parse({ ...service, productMode: "new", variantId: "" })).toMatchObject({ productMode: "new", variantId: null, priceCents: 1250 });
  });
  it("defaults existing setup and still requires a paid linked variant", () => {
    expect(serviceSchema.parse(service).productMode).toBe("existing");
    expect(serviceSchema.safeParse({ ...service, productMode: "existing", variantId: "" }).success).toBe(false);
    expect(serviceSchema.safeParse({ ...service, productMode: "unknown" }).success).toBe(false);
  });
});

describe("additional opening inputs", () => {
  const hours = { locationId: "location", staffId: "", date: "2026-03-02", startTime: "09:00", endTime: "12:00", timezone: "Asia/Kolkata", note: "Extra appointments" };
  it("stores opening instants in UTC with their scheduling timezone", () => {
    const parsed = additionalHoursSchema.parse(hours);
    expect(parsed.startAt.toISOString()).toBe("2026-03-02T03:30:00.000Z");
    expect(parsed.endAt.toISOString()).toBe("2026-03-02T06:30:00.000Z");
    expect(parsed.timezone).toBe("Asia/Kolkata");
    expect(parsed.staffId).toBeUndefined();
  });
  it("accepts overnight openings but not equal endpoints", () => {
    const parsed = additionalHoursSchema.parse({ ...hours, startTime: "23:00", endTime: "02:00", timezone: "UTC" });
    expect(parsed.endAt.toISOString()).toBe("2026-03-03T02:00:00.000Z");
    expect(additionalHoursSchema.safeParse({ ...hours, endTime: "09:00" }).success).toBe(false);
  });
  it("requires a location and a real calendar date", () => {
    expect(additionalHoursSchema.safeParse({ ...hours, locationId: "" }).success).toBe(false);
    expect(additionalHoursSchema.safeParse({ ...hours, date: "2026-02-30" }).success).toBe(false);
  });
  it("rejects nonexistent and ambiguous opening boundaries", () => {
    expect(additionalHoursSchema.safeParse({ ...hours, date: "2026-03-08", startTime: "02:30", endTime: "04:00", timezone: "America/New_York" }).success).toBe(false);
    expect(additionalHoursSchema.safeParse({ ...hours, date: "2026-11-01", startTime: "01:30", endTime: "03:00", timezone: "America/New_York" }).success).toBe(false);
  });
});
