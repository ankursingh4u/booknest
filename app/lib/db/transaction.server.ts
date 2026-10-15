import { Prisma } from "@prisma/client";
import { assertShopId, scopeTenantQuery, validateTenantReferences } from "./tenant.server";

type Delegate = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;
/** All reads and reference checks use this transaction, including newly inserted rows. */
export function tenantTransaction(client: Prisma.TransactionClient, shopId: string): Prisma.TransactionClient {
  assertShopId(shopId);
  const delegates = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name[0]!.toLowerCase() + model.name.slice(1), model.name]));
  const cache = new Map<string, unknown>();
  const raw = client as unknown as Record<string, Delegate>;
  return new Proxy({} as Prisma.TransactionClient, {
    get(_target, key) {
      if (typeof key !== "string" || key.startsWith("$") || !delegates.has(key)) throw new Error("Only tenant-scoped model operations are available");
      if (cache.has(key)) return cache.get(key);
      const model = delegates.get(key)!;
      const wrapped = new Proxy({}, {
        get(_delegate, operation) {
          if (typeof operation !== "string") throw new Error("Invalid model operation");
          return async (args: Record<string, unknown> = {}) => {
            const scoped = scopeTenantQuery(model, operation, args, shopId, true);
            const lookup = async (relatedModel: string, where: Record<string, unknown>) => {
              const relatedKey = relatedModel[0]!.toLowerCase() + relatedModel.slice(1);
              return Boolean(await raw[relatedKey]!.findFirst!({ where }));
            };
            for (const field of ["data", "create", "update"]) {
              if (field in scoped) await validateTenantReferences(model, scoped[field], shopId, lookup);
            }
            const method = raw[key]?.[operation];
            if (!method) throw new Error("Unsupported model operation");
            return method.call(raw[key], scoped);
          };
        },
      });
      cache.set(key, wrapped);
      return wrapped;
    },
  });
}
