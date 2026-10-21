import { z } from "zod";
import type { ActionFunctionArgs } from "react-router";
import { requireShop } from "../lib/auth/admin.server";
import { ruleSchema, ruleUpdateSchema, formValues } from "../lib/admin/schemas";
import { formError } from "../lib/admin/errors.server";

export async function action({ request }: ActionFunctionArgs) {
  const { db, shop } = await requireShop(request);
  const form = await request.formData();
  try {
    const intent = z.enum(["rule.save", "rule.update", "rule.delete"]).parse(form.get("intent"));
    if (intent === "rule.delete") await db.availabilityRule.delete({ where: { id: z.string().min(1).max(100).parse(form.get("id")) } });
    else if (intent === "rule.save") {
      await db.availabilityRule.create({ data: { ...ruleSchema.parse(formValues(form)), shopId: shop.id } });
    } else {
      const { id, ...data } = ruleUpdateSchema.parse(formValues(form));
      await db.availabilityRule.update({ where: { id }, data });
    }
    return { ok: true };
  } catch (error) { return formError(error); }
}
