import { z } from "zod";
import { Form, Link, redirect, useActionData, useLoaderData, useLocation, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Banner } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { formError } from "../lib/admin/errors.server";
import { AdminField as Field, AdminSelectField as SelectField, AdminSaveButton as SaveButton, AdminRecordAction as RecordAction, AdminCheckbox } from "../components/AdminFields";
const questionSchema = z.object({
  serviceId: z.string().min(1).max(100), label: z.string().trim().min(1).max(500),
  type: z.enum(["TEXT", "TEXTAREA", "SELECT"]), required: z.boolean(),
  options: z.string().max(5000).transform(value => [...new Set(value.split("\n").map(s => s.trim()).filter(Boolean))]).refine(values => values.length <= 50),
  sortOrder: z.coerce.number().int().min(0).max(1000),
}).refine(value => value.type !== "SELECT" || value.options.length > 0, "Add at least one option for a selection question.");
export async function loader({ request }: LoaderFunctionArgs) {
  const { db } = await requireShop(request);
  const [questions, services] = await Promise.all([
    db.intakeQuestion.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 500 }),
    db.service.findMany({ where: { active: true }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);
  return { questions, services };
}
export async function action({ request }: ActionFunctionArgs) {
  const { db, shop } = await requireShop(request);
  const form = await request.formData();
  try {
    const id = z.string().max(100).parse(form.get("id") ?? "");
    const intent = z.enum(["save", "archive"]).parse(form.get("intent") ?? "save");
    if (intent === "archive") await db.intakeQuestion.update({ where: { id }, data: { active: false } });
    else {
      const values = questionSchema.parse({ ...Object.fromEntries(form), required: form.has("required") });
      if (id) {
        const existing = await db.intakeQuestion.findUniqueOrThrow({ where: { id } });
        await db.intakeQuestion.update({ where: { id }, data: { ...values, serviceId: existing.serviceId } });
      } else await db.intakeQuestion.create({ data: { ...values, shopId: shop.id } });
    }
    return redirect("/app/intake?saved=1");
  } catch (error) { return formError(error); }
}
export default function Intake() {
  const { questions, services } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>(); const [search] = useSearchParams(); const location = useLocation();
  const edit = questions.find(question => question.id === search.get("edit"));
  return <Page title="Intake Questions" subtitle="Extra details you ask customers for when they book an Event/Service"><BlockStack gap="400">
    {result && <Banner tone="critical">{result.error}{Object.values(result.fields).flat().map((error, i) => <p key={i}>{error}</p>)}</Banner>}
    <div className="bn-editor-layout"><Card><BlockStack gap="400"><Link to="?new=1">Add a question</Link>
      {!questions.length && <p>No intake questions yet.</p>}
      {questions.map(question => <article className="bn-record" key={question.id}><div><Link to={"?edit=" + question.id}>{question.label}</Link>
        <p>{services.find(service => service.id === question.serviceId)?.title} · {question.required ? "Required" : "Optional"}</p></div>
        <RecordAction id={question.id} intent="archive">Archive</RecordAction></article>)}
    </BlockStack></Card>
    <Card><Form method="post" className="bn-form" key={location.key}><Text as="h2" variant="headingMd">{edit ? "Edit question" : "Add question"}</Text>
      <input type="hidden" name="id" value={edit?.id ?? ""} /><input type="hidden" name="intent" value="save" />
      <SelectField name="serviceId" label="Event/Service" value={edit?.serviceId} required options={services.map(service => ({ value: service.id, label: service.title }))} />
      <Field name="label" label="Question" value={edit?.label} required />
      <SelectField name="type" label="Answer format" value={edit?.type ?? "TEXT"} required options={[{ value: "TEXT", label: "Short text" }, { value: "TEXTAREA", label: "Long text" }, { value: "SELECT", label: "Choose an option" }]} />
      <Field name="options" label="Options, one per line" type="textarea" value={edit?.options.join("\n")} />
      <Field name="sortOrder" label="Display order" type="number" value={edit?.sortOrder ?? 0} />
      <AdminCheckbox name="required" label="Required answer" defaultChecked={edit?.required ?? false} /><SaveButton>Save question</SaveButton>
    </Form></Card></div>
  </BlockStack></Page>;
}
