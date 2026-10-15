import { Prisma } from "@prisma/client";

type Args = Record<string, unknown>;
const directModels = new Set([
  "Subscription", "TeamSeat", "SeatUsage", "Location", "StaffMember", "TimeOffRequest", "Service",
  "AvailabilityRule", "AdditionalHours", "Blackout", "Booking", "IntakeQuestion", "NotificationTemplate",
  "InsightsSnapshot", "WaitlistEntry", "Reservation", "WebhookReceipt", "NotificationTask", "GoogleOAuthState",
  "AccessLog",
]);
const readOperations = new Set([
  "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
  "count", "aggregate", "groupBy", "delete", "deleteMany",
]);
const createOperations = new Set(["create", "createMany", "createManyAndReturn"]);
const updateOperations = new Set(["update", "updateMany", "updateManyAndReturn"]);
const relationModels = new Set(["ServiceStaff", "IntakeAnswer", "JobLog"]);


// These IDs are scalar fields without declared Prisma relations in the scaffold.
const scalarReferences: Record<string, { type: string; relationFromFields: string[]; relationToFields: string[] }[]> = {
  Booking: [{ type: "StaffMember", relationFromFields: ["googleEventStaffId"], relationToFields: ["id"] }],
  TeamSeat: [{ type: "StaffMember", relationFromFields: ["staffId"], relationToFields: ["id"] }],
  WaitlistEntry: [
    { type: "Service", relationFromFields: ["serviceId"], relationToFields: ["id"] },
    { type: "StaffMember", relationFromFields: ["staffId"], relationToFields: ["id"] },
  ],
  IntakeAnswer: [{ type: "IntakeQuestion", relationFromFields: ["questionId"], relationToFields: ["id"] }],
};

function asObject(value: unknown): Args {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected Prisma arguments to be an object");
  }
  return value as Args;
}

export function assertShopId(shopId: string): void {
  if (typeof shopId !== "string" || shopId.trim() !== shopId || !shopId) {
    throw new Error("A non-empty authenticated shopId is required");
  }
}

function ownershipFilter(model: string, shopId: string): Args {
  if (model === "Shop") return { id: shopId };
  if (directModels.has(model)) return { shopId };
  if (model === "ServiceStaff") return { service: { shopId }, staff: { shopId } };
  if (model === "IntakeAnswer") return { booking: { shopId } };
  if (model === "JobLog") return { booking: { is: { shopId } } };
  throw new Error("Unsupported tenant model: " + model);
}

function scopeData(model: string, value: unknown, shopId: string): Args {
  const data = asObject(value);
  const ownerKey = model === "Shop" ? "id" : "shopId";
  if (ownerKey in data && data[ownerKey] !== shopId) {
    throw new Error("Tenant ownership cannot be changed");
  }
  const definition = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model);
  for (const field of definition?.fields ?? []) {
    if (field.kind === "object" && field.name in data) {
      throw new Error("Nested relation writes require a tenant-scoped repository");
    }
  }
  if (relationModels.has(model)) return { ...data };
  if (model === "Shop") return { ...data };
  return { ...data, shopId };
}

/** Preserve caller filters, including unique keys, and intersect them with ownership. */
export function scopeTenantQuery(model: string, operation: string, args: Args, shopId: string, allowRelationCreation = false): Args {
  assertShopId(shopId);
  const filter = ownershipFilter(model, shopId);
  if (!readOperations.has(operation) && !createOperations.has(operation)
    && !updateOperations.has(operation) && operation !== "upsert") {
    throw new Error("Unsupported tenant operation: " + operation);
  }
  if (createOperations.has(operation) || operation === "upsert") {
    if (model === "Shop") throw new Error("Shop bootstrap requires the authenticated identity repository");
    if (relationModels.has(model) && (!allowRelationCreation || model === "JobLog")) throw new Error("Relation-owned creation requires a tenant-scoped repository");
  }
  const result = { ...args };
  if (!createOperations.has(operation)) {
    const where = asObject(args.where);
    const existing = where.AND === undefined ? [] : Array.isArray(where.AND) ? where.AND : [where.AND];
    result.where = { ...where, AND: [...existing, filter] };
  }
  if (createOperations.has(operation) || updateOperations.has(operation)) {
    result.data = Array.isArray(args.data)
      ? args.data.map((row) => scopeData(model, row, shopId))
      : scopeData(model, args.data, shopId);
  }
  if (operation === "upsert") {
    result.create = scopeData(model, args.create, shopId);
    result.update = scopeData(model, args.update, shopId);
  }
  return result;
}

export type OwnershipLookup = (model: string, where: Args) => Promise<boolean>;

/** Scalar foreign keys also need ownership checks: matching shopId alone is insufficient. */
export async function validateTenantReferences(
  model: string, value: unknown, shopId: string, lookup: OwnershipLookup,
): Promise<void> {
  assertShopId(shopId);
  const rows = Array.isArray(value) ? value : [value];
  const definition = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model);
  if (!definition) throw new Error("Unsupported tenant model: " + model);
  for (const row of rows) {
    const data = asObject(row);
    const references = [...definition.fields.filter((field) => field.kind === "object"), ...(scalarReferences[model] ?? [])];
    for (const relation of references) {
      const from = relation.relationFromFields ?? [];
      const to = relation.relationToFields ?? [];
      if (!from.length || !from.some((key) => key in data)) continue;
      const where: Args = {};
      let isNull = false;
      for (let index = 0; index < from.length; index++) {
        const key = from[index]!;
        const target = to[index]!;
        const raw = data[key];
        const id = raw !== null && typeof raw === "object" ? asObject(raw).set : raw;
        if (id === null) { isNull = true; break; }
        if (typeof id !== "string" || !id) throw new Error("Invalid tenant reference: " + key);
        where[target] = id;
      }
      if (isNull) {
        if (relationModels.has(model)) throw new Error("Tenant ownership cannot be detached");
        continue;
      }
      if (!await lookup(relation.type, { ...where, AND: [ownershipFilter(relation.type, shopId)] })) {
        throw new Error("Related record does not belong to this shop");
      }
    }
    if (model === "StaffMember" && "locationIds" in data) {
      const raw = data.locationIds;
      // Push cannot be checked without reading and rewriting the entire list.
      const ids = Array.isArray(raw) ? raw : asObject(raw).set;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id)) {
        throw new Error("locationIds must be an explicit list of owned locations");
      }
      for (const id of ids) {
        if (!await lookup("Location", { id, AND: [{ shopId }] })) {
          throw new Error("Related record does not belong to this shop");
        }
      }
    }
  }
}
