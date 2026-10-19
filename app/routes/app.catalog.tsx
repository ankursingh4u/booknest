import { useState } from "react";
import { z } from "zod";
import { useAppBridge } from "@shopify/app-bridge-react";
import { data, Form, Link, redirect, useActionData, useLoaderData, useLocation, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Badge, Banner, RadioButton, TextField, Button, Tabs, EmptyState } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { catalogData, catalogKind, mutateCatalog } from "../lib/admin/catalog.server";
import { formError } from "../lib/admin/errors.server";
import { AdminField as Field, AdminSelectField as SelectField, AdminMultiField as MultiField, AdminSaveButton as SaveButton, AdminRecordAction as RecordAction } from "../components/AdminFields";
import { verifyBookingVariant } from "../lib/shopify/variant.server";
import { createBookingProduct } from "../lib/shopify/product-setup.server";
const titles = { locations: "Locations", availabilities: "Availabilities", services: "Events/Services" };
type Row = { id: string; title: string; summary: string; active: boolean; values: Record<string, string>; selected: string[] };
export async function loader({ request, params }: LoaderFunctionArgs) {
  const kind = catalogKind.parse(params.kind);
  const { shop } = await requireShop(request);
  const result = await catalogData(shop.id);
  const stringify = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value == null ? "" : String(value)]));
  let rows: Row[];
  if (kind === "locations") rows = result.locations.map(item => ({ id: item.id, title: item.name, summary: item.timezone, active: item.active, values: stringify(item), selected: [] }));
  else if (kind === "availabilities") rows = result.staff.map(item => ({ id: item.id, title: item.firstName + " " + item.lastName, summary: item.email, active: item.active, values: stringify(item), selected: item.locationIds }));
  else rows = result.services.map(item => ({ id: item.id, title: item.title, summary: item.durationMin + " min · " + item.capacity + " seat(s)", active: item.active,
    values: stringify({ ...item, price: (item.priceCents / 100).toFixed(2), depositValue: item.depositType === "PERCENT" ? item.depositValue : (item.depositValue / 100).toFixed(2) }),
    selected: item.staff.map(assignment => assignment.staffId) }));
  return { kind, title: titles[kind], rows, creationKey: crypto.randomUUID(), timezone: result.shop.timezone, currency: result.shop.currency,
    locations: result.locations.filter(item => item.active).map(item => ({ value: item.id, label: item.name })),
    staff: result.staff.filter(item => item.active).map(item => ({ value: item.id, label: item.firstName + " " + item.lastName })),
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  const { shop, admin } = await requireShop(request);
  const kind = catalogKind.parse(params.kind);
  const form = await request.formData();
  try {
    const record = await mutateCatalog(shop.id, kind, form, (id, cents) => verifyBookingVariant(admin, id, cents), input => createBookingProduct(admin, input));
    return redirect("/app/manage/" + kind + "?saved=1" + (kind === "services" ? "&edit=" + encodeURIComponent(record.id) : ""));
  }
  catch (error) {
    const failure = formError(error);
    return data({ ...failure.data, submitted: submittedCatalogForm(form) }, failure.init ?? undefined);
  }
}
export default function Catalog() {
  const { kind, title, rows, locations, staff, timezone, currency, creationKey } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [search] = useSearchParams();
  const location = useLocation();
  const edit = rows.find(row => row.id === search.get("edit"));
  const submitted = result?.submitted?.id === (edit?.id ?? "") ? result.submitted : null;
  const value = { ...edit?.values, ...submitted?.values };
  const field = (name: string, label: string, type = "text", fallback = "", required = false, help?: string) =>
    <Field name={name} label={label} type={type} value={value[name] ?? fallback} required={required} help={help} errors={result?.fields[name]} step={type === "number" ? "1" : undefined} />;
  const noun = kind === "services" ? "Event/Service" : kind === "availabilities" ? "Availability" : "location";
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const visible = rows.filter(row => (tab === "active" ? row.active : !row.active)
    && (query === "" || row.title.toLowerCase().includes(query.toLowerCase()) || row.summary.toLowerCase().includes(query.toLowerCase())));
  return <Page title={title}><BlockStack gap="400">
    {search.has("saved") && !result && <Banner tone="success">Changes saved.</Banner>}
    {result && <Banner tone="critical"><p>{result.error}</p>{Object.entries(result.fields).map(([name, errors]) => errors?.map(error => <p key={name + error}>{name}: {error}</p>))}</Banner>}
    <div className="bn-editor-layout"><Card padding="0"><BlockStack gap="0">
      <div className="bn-heading-row" style={{ padding: "var(--bn-space-4)" }}><Text as="h2" variant="headingMd">{title}</Text><Button variant="primary" url="?new=1">+ Create</Button></div>
      <Tabs tabs={[{ id: "active", content: "Active" }, { id: "archived", content: "Archived" }]} selected={tab === "active" ? 0 : 1} onSelect={index => setTab(index === 0 ? "active" : "archived")} />
      <div style={{ padding: "var(--bn-space-4)" }}><TextField label="Search" labelHidden value={query} onChange={setQuery} placeholder={"Search by name or email"} autoComplete="off" /></div>
      {!visible.length ? <div style={{ padding: "var(--bn-space-4)" }}><EmptyState heading={rows.length ? "No matches" : "Add your first " + noun.toLowerCase()}
        image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg" action={rows.length ? undefined : { content: "+ Create", url: "?new=1" }}>
        <p>{rows.length ? "Try a different search or switch tabs." : "Get started by adding a " + noun.toLowerCase() + "."}</p>
      </EmptyState></div> : <BlockStack gap="0">
        {visible.map(row => <article className="bn-record" key={row.id} style={{ padding: "0 var(--bn-space-4)" }}>
          <div><Link to={"?edit=" + row.id}>{row.title}</Link><p>{row.summary}</p>{kind === "services" && <p>Event/Service ID: <code>{row.id}</code></p>}<Badge tone={row.active ? "success" : undefined}>{row.active ? "Active" : "Archived"}</Badge></div>
          <RecordAction id={row.id} intent={row.active ? "archive" : "restore"}>{row.active ? "Archive" : "Restore"}</RecordAction>
        </article>)}
        {rows.length >= 500 && <Text as="p">Showing the first 500 records.</Text>}
      </BlockStack>}
    </BlockStack></Card>
    <Card><Form method="post" className="bn-form" key={location.key}>
      <Text as="h2" variant="headingMd">{edit ? "Edit " + edit.title : "Add " + (kind === "services" ? "Event/Service" : kind === "availabilities" ? "Availability" : "location")}</Text>
      <input type="hidden" name="intent" value="save" /><input type="hidden" name="id" value={edit?.id ?? ""} />
      {kind === "locations" && <>{field("name", "Location name", "text", "", true)}{field("address", "Address", "textarea")}{field("timezone", "Timezone", "text", timezone, true, "IANA name, for example Asia/Kolkata.")}</>}
      {kind === "availabilities" && <>
        {field("firstName", "First name", "text", "", true)}{field("lastName", "Last name", "text", "", true)}
        {field("email", "Email", "email", "", true)}{field("phone", "Phone", "tel")}
        {field("timezone", "Timezone", "text", timezone, true)}{field("contactLink", "Contact Link", "url", "", false, "Your meeting or video call link.")}
        {field("imageUrl", "Profile image URL", "url")}{field("bio", "Description", "textarea")}
        <MultiField name="locationIds" label="Locations" selected={submitted?.locationIds ?? edit?.selected ?? []} options={locations} />
        <Link to="/app/schedules">Manage working hours and time off</Link>
      </>}
      {kind === "services" && <>
        {field("title", "Event/Service name", "text", "", true)}{field("slug", "URL name", "text", "", true, "Lowercase words separated by hyphens.")}
        {field("description", "Description", "textarea")}
        <SelectField name="locationId" label="Location" value={value.locationId} options={locations} required />
        <MultiField name="staffIds" label="Availabilities" selected={submitted?.staffIds ?? edit?.selected ?? []} options={staff} />
        <div className="bn-form-grid">{field("durationMin", "Duration (minutes)", "number", "60", true)}{field("capacity", "Seats per time", "number", "1", true)}
        {field("slotIntervalMin", "Slot interval (minutes)", "number", "", false, "Leave blank to offer starts at the Event/Service duration.")}
        {field("bufferBefore", "Buffer before (minutes)", "number", "0")}{field("bufferAfter", "Buffer after (minutes)", "number", "0")}</div>
        <ProductSetup initialVariant={value.variantId ?? ""} initialPrice={value.price ?? "0.00"} creationKey={submitted?.creationKey || creationKey} initialMode={value.productMode === "new" ? "new" : "existing"} currency={currency} errors={result?.fields} />
        <SelectField name="depositType" label="Payment" value={value.depositType ?? "NONE"} options={[{ value: "NONE", label: "Full payment at checkout" }, { value: "FULL", label: "Full payment" }, { value: "FIXED", label: "Fixed deposit" }, { value: "PERCENT", label: "Percentage deposit" }]} />
        {field("depositValue", "Deposit amount or percentage", "text", "0")}
        <div className="bn-form-grid">{field("minNoticeHours", "Minimum notice (hours)", "number", "1")}{field("maxAdvanceDays", "Booking window (days)", "number", "60")}</div>
        <div className="bn-form-grid">{field("customerCancelCutoffHours", "Customer cancellation cutoff (hours)", "number", "0", false, "Customers can cancel until this many hours before the booking.")}
        {field("customerRescheduleCutoffHours", "Customer reschedule cutoff (hours)", "number", "0", false, "Customers can reschedule until this many hours before the booking.")}</div>
      </>}
      <SaveButton>{edit ? "Save changes" : "Create"}</SaveButton>
    </Form></Card></div>
  </BlockStack></Page>;
}

function ProductSetup({ initialVariant, initialPrice, creationKey, initialMode, currency, errors }: {
  initialVariant: string; initialPrice: string; creationKey: string; initialMode: "existing" | "new"; currency: string; errors?: Record<string, string[] | undefined>;
}) {
  const bridge = useAppBridge();
  const [key] = useState(creationKey);
  const [mode, setMode] = useState<"existing" | "new">(initialMode);
  const [variantId, setVariantId] = useState(initialVariant);
  const [price, setPrice] = useState(initialPrice);
  const [label, setLabel] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [pickerError, setPickerError] = useState("");
  async function chooseVariant() {
    setPickerError(""); setChoosing(true);
    try {
      const selection = await bridge.resourcePicker({
        type: "variant", action: "select", multiple: false, filter: { query: "status:active" },
        selectionIds: variantId.startsWith("gid://") ? [{ id: variantId }] : undefined,
      });
      const selected = selection?.[0];
      if (selected) {
        setVariantId(selected.id); setLabel(selected.displayName || selected.product.title || selected.title);
        setPrice(String(selected.price)); setMode("existing");
      }
    } catch {
      setPickerError("Shopify's product picker could not open. Retry, or enter a variant ID below.");
    } finally { setChoosing(false); }
  }
  return <>
    <input type="hidden" name="creationKey" value={key} />
    <TextField label={"Price (" + currency + ")"} id="price" name="price" inputMode="decimal" value={price} onChange={setPrice}
      requiredIndicator error={errors?.price?.[0]} autoComplete="off" />
    <fieldset className="bn-options"><legend>Shopify product for paid bookings</legend>
      <RadioButton name="productMode" value="existing" label="Choose an existing product" checked={mode === "existing"} onChange={() => setMode("existing")} />
      <RadioButton name="productMode" value="new" label="Create a new booking product" checked={mode === "new"} onChange={() => setMode("new")} />
    </fieldset>
    {mode === "existing" ? <div className="bn-field">
      <input type="hidden" name="variantId" value={variantId} />
      <p>{label || (variantId ? "A Shopify product variant is linked." : "Choose the product variant customers will purchase.")}</p>
      <Button onClick={chooseVariant} loading={choosing} disabled={choosing}>{choosing ? "Opening Shopify…" : variantId ? "Change Shopify product" : "Choose Shopify product"}</Button>
      {pickerError && <p className="bn-error" role="alert">{pickerError}</p>}
      <small>The picker fills the product price. BookNest verifies the active variant and price when you save. Free bookings do not require a product.</small>
      <details><summary>Enter a variant ID manually</summary>
        <TextField label="Shopify product variant ID" id="manualVariantId" value={variantId}
          onChange={value => { setVariantId(value); setLabel(""); }} error={Boolean(errors?.variantId?.length)} placeholder="Numeric ID or Shopify GID" autoComplete="off" />
      </details>
    </div> : <p>Saving a paid Event/Service creates one Shopify product at this price and publishes it to your Online Store. The booking product does not require shipping. Retrying this form reuses the same product.</p>}
  </>;
}

function submittedCatalogForm(form: FormData) {
  if ((form.get("intent") ?? "save") !== "save") return null;
  const editable = ["name", "address", "timezone", "firstName", "lastName", "email", "phone", "contactLink", "imageUrl", "bio",
    "title", "slug", "description", "locationId", "durationMin", "capacity", "slotIntervalMin", "bufferBefore", "bufferAfter",
    "price", "variantId", "productMode", "depositType", "depositValue", "minNoticeHours", "maxAdvanceDays",
    "customerCancelCutoffHours", "customerRescheduleCutoffHours"];
  const values: Record<string, string> = {};
  for (const name of editable) { const value = form.get(name); if (typeof value === "string") values[name] = value.slice(0, 5000); }
  const identifiers = (name: string) => form.getAll(name).filter((value): value is string => typeof value === "string" && value.length <= 100).slice(0, 50);
  const key = z.string().uuid().safeParse(form.get("creationKey"));
  const id = form.get("id");
  return { id: typeof id === "string" ? id.slice(0, 100) : "", values, staffIds: identifiers("staffIds"), locationIds: identifiers("locationIds"), creationKey: key.success ? key.data : "" };
}
