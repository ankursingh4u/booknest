import { z } from "zod";
import { newServiceIdentity, productIdentity } from "../shopify/product-setup.server";
import type { BookingProductInput } from "../shopify/product-setup.server";
import { getShopDatabase, withShopTransaction } from "../../db.server";
import { locationSchema, serviceSchema, staffSchema, formValues } from "./schemas";
export const catalogKind = z.enum(["locations", "availabilities", "services"]);
export class CatalogError extends Error {}
export const publicStaff = {
  id: true, firstName: true, lastName: true, email: true, phone: true, contactLink: true,
  imageUrl: true, bio: true, timezone: true, locationIds: true, active: true,
  _count: { select: { availability: true } },
} as const;
function storeDisplayName(domain: string) {
  return domain.replace(/\.myshopify\.com$/, "").replace(/-/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}
export async function catalogData(shopId: string) {
  const db = getShopDatabase(shopId);
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { timezone: true, currency: true, domain: true, email: true } });
  // Most merchants run one location and one Availability; skip the separate setup steps by giving them defaults instead of requiring manual creation first.
  let defaultLocationId: string | undefined;
  if (await db.location.count() === 0) {
    defaultLocationId = (await db.location.create({ data: { name: "Main location", timezone: shop.timezone, shopId } })).id;
  }
  if (await db.staffMember.count() === 0) {
    const locationId = defaultLocationId ?? (await db.location.findFirst({ select: { id: true } }))!.id;
    await db.staffMember.create({ data: {
      firstName: storeDisplayName(shop.domain), lastName: "", email: shop.email || "owner@" + shop.domain,
      timezone: shop.timezone, locationIds: [locationId], shopId,
    } });
  }
  const [locations, staff, services] = await Promise.all([
    db.location.findMany({ orderBy: { name: "asc" }, take: 500 }),
    db.staffMember.findMany({ select: publicStaff, orderBy: { firstName: "asc" }, take: 500 }),
    db.service.findMany({ include: { staff: { select: { staffId: true } } }, orderBy: { title: "asc" }, take: 500 }),
  ]);
  return { locations, staff, services, shop };
}
export async function mutateCatalog(shopId: string, kind: z.infer<typeof catalogKind>, form: FormData, verifyVariant?: (id: string, cents: number) => Promise<void>, createProduct?: (input: BookingProductInput) => Promise<{ variantId: string }>) {
  const intent = z.enum(["save", "archive", "restore"]).parse(form.get("intent") ?? "save");
  const id = z.string().max(100).optional().parse(form.get("id") || undefined);
  const db = getShopDatabase(shopId);
  if (intent !== "save") {
    if (!id) throw new CatalogError("Choose a record first.");
    const active = intent === "restore";
    if (kind === "locations") {
      if (!active && (await db.service.count({ where: { locationId: id, active: true } }))) throw new CatalogError("Archive the Events/Services at this location first.");
      return db.location.update({ where: { id }, data: { active } });
    }
    if (kind === "availabilities") return db.staffMember.update({ where: { id }, data: { active } });
    return db.service.update({ where: { id }, data: { active } });
  }
  const values = formValues(form);
  if (kind === "locations") {
    const data = locationSchema.parse(values);
    return id ? db.location.update({ where: { id }, data }) : db.location.create({ data: { ...data, shopId } });
  }
  if (kind === "availabilities") {
    const data = staffSchema.parse(values);
    const found = await db.location.count({ where: { id: { in: data.locationIds }, active: true } });
    if (found !== data.locationIds.length) throw new CatalogError("Choose active locations belonging to your store.");
    return id ? db.staffMember.update({ where: { id }, data }) : db.staffMember.create({ data: { ...data, shopId } });
  }
  const { staffIds, productMode, ...data } = serviceSchema.parse(values);
  const serviceId = id ?? newServiceIdentity(shopId, z.string().uuid().parse(form.get("creationKey")));
  return withShopTransaction(shopId, async tx => {
    // Validate tenant ownership and all local references before creating any Shopify resource.
    const existing = await tx.service.findFirst({ where: { id: serviceId }, include: { staff: { select: { staffId: true } } } });
    if (id && !existing) throw new CatalogError("Choose an Event/Service belonging to your store.");
    const collision = await tx.service.findFirst({ where: { slug: data.slug, id: { not: serviceId } }, select: { id: true } });
    if (collision) throw new CatalogError("This URL name is already used by another Event/Service.");
    const location = await tx.location.findFirst({ where: { id: data.locationId, active: true } });
    if (!location) throw new CatalogError("Choose an active location belonging to your store.");
    const available = await tx.staffMember.count({ where: { id: { in: staffIds }, active: true, locationIds: { has: data.locationId } } });
    if (available !== staffIds.length) throw new CatalogError("Each selected Availability must be active at this location.");
    if (!id && existing) {
      const fields = existing as unknown as Record<string, unknown>;
      const equalFields = Object.entries(data).every(([name, value]) => name === "variantId" && productMode === "new" ? true : fields[name] === value);
      const assigned = existing.staff.map(item => item.staffId).sort().join("\n");
      if (!equalFields || !existing.active || assigned !== [...staffIds].sort().join("\n"))
        throw new CatalogError("This creation key was already used. Edit the existing Event/Service or open a new form.");
      if (existing.priceCents > 0 && existing.variantId) {
        if (!verifyVariant) throw new CatalogError("Shopify product verification is required.");
        await verifyVariant(existing.variantId, existing.priceCents);
      }
      return existing;
    }
    if (data.priceCents > 0) {
      if (!verifyVariant) throw new CatalogError("Shopify product verification is required.");
      if (productMode === "new") {
        if (!createProduct) throw new CatalogError("Shopify product creation is not configured.");
        const product = await createProduct({ shopId, serviceId, title: data.title, description: data.description, priceCents: data.priceCents });
        data.variantId = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/).parse(product.variantId);
      }
      if (!data.variantId) throw new CatalogError("Choose a Shopify product variant for paid bookings.");
      await verifyVariant(data.variantId, data.priceCents);
    } else if (productMode === "new") {
      data.variantId = null;
    }
    const service = id ? await tx.service.update({ where: { id }, data }) : await tx.service.create({ data: { ...data, id: serviceId, shopId } });
    await tx.serviceStaff.deleteMany({ where: { serviceId: service.id } });
    await tx.serviceStaff.createMany({ data: staffIds.map(staffId => ({ serviceId: service.id, staffId })) });
    return service;
  }, ["service:" + serviceId, "service-slug:" + productIdentity(shopId, data.slug).marker]);
}
