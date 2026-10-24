import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAppBridge } from "@shopify/app-bridge-react";
import { data, Form, Link, redirect, useActionData, useFetcher, useLoaderData, useLocation, useNavigate, useSearchParams } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Page, Card, BlockStack, Text, Badge, Banner, RadioButton, TextField, Button, Tabs, EmptyState } from "@shopify/polaris";
import { requireShop } from "../lib/auth/admin.server";
import { catalogData, catalogKind, mutateCatalog } from "../lib/admin/catalog.server";
import { formError } from "../lib/admin/errors.server";
import { AdminField as Field, AdminSelectField as SelectField, AdminMultiField as MultiField, AdminSaveButton as SaveButton, AdminRecordAction as RecordAction, AdminChoiceCard, AdminTimezoneField } from "../components/AdminFields";
import { WeeklyHoursTable } from "../components/WeeklyHoursTable";
import { verifyBookingVariant } from "../lib/shopify/variant.server";
import { createBookingProduct } from "../lib/shopify/product-setup.server";
const titles = { locations: "Locations", availabilities: "Availabilities", services: "Events/Services" };
const subtitles = {
  locations: "Places where appointments happen, each with its own timezone.",
  availabilities: "The staff or resources customers can book. Set their working hours in Schedules.",
  services: "What customers book: duration, price, and which Availabilities can perform it.",
};
type Row = { id: string; title: string; summary: string; active: boolean; values: Record<string, string>; selected: string[] };
export async function loader({ request, params }: LoaderFunctionArgs) {
  const kind = catalogKind.parse(params.kind);
  const { shop, db } = await requireShop(request);
  const result = await catalogData(shop.id);
  const rules = kind === "availabilities" ? await db.availabilityRule.findMany({ where: { staffId: { not: null } },
    select: { id: true, staffId: true, serviceId: true, weekday: true, startTime: true, endTime: true } }) : [];
  const stringify = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value == null ? "" : String(value)]));
  let rows: Row[];
  if (kind === "locations") rows = result.locations.map(item => ({ id: item.id, title: item.name, summary: item.timezone, active: item.active, values: stringify(item), selected: [] }));
  else if (kind === "availabilities") rows = result.staff.map(item => ({ id: item.id, title: item.firstName + " " + item.lastName, summary: item.email, active: item.active,
    values: { ...stringify(item), hasHours: item._count.availability > 0 ? "1" : "" }, selected: item.locationIds }));
  else rows = result.services.map(item => ({ id: item.id, title: item.title, summary: item.durationMin + " min · " + item.capacity + " seat(s)", active: item.active,
    values: stringify({ ...item, price: (item.priceCents / 100).toFixed(2), depositValue: item.depositType === "PERCENT" ? item.depositValue : (item.depositValue / 100).toFixed(2) }),
    selected: item.staff.map(assignment => assignment.staffId) }));
  return { kind, title: titles[kind], rows, creationKey: crypto.randomUUID(), timezone: result.shop.timezone, currency: result.shop.currency, rules,
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
  const { kind, title, rows, locations, staff, timezone, currency, creationKey, rules } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const edit = rows.find(row => row.id === search.get("edit"));
  const creatingService = kind === "services" && !edit && search.has("new");
  const open = Boolean(edit) || (search.has("new") && !creatingService);
  const submitted = result?.submitted?.id === (edit?.id ?? "") ? result.submitted : null;
  const value = { ...edit?.values, ...submitted?.values };
  const field = (name: string, label: string, type = "text", fallback = "", required = false, help?: string) =>
    <Field name={name} label={label} type={type} value={value[name] ?? fallback} required={required} help={help} errors={result?.fields[name]} step={type === "number" ? "1" : undefined} />;
  const noun = kind === "services" ? "Event/Service" : kind === "availabilities" ? "Availability" : "location";
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [query, setQuery] = useState("");
  const visible = rows.filter(row => (tab === "active" ? row.active : !row.active)
    && (query === "" || row.title.toLowerCase().includes(query.toLowerCase()) || row.summary.toLowerCase().includes(query.toLowerCase())));
  const close = () => navigate(location.pathname);
  const themeLink = useFetcher<{ url: string }>();
  useEffect(() => { if (themeLink.data?.url) window.open(themeLink.data.url, "_top"); }, [themeLink.data]);
  return <Page title={title} subtitle={subtitles[kind]}><BlockStack gap="400">
    {search.has("saved") && !result && <Banner tone="success">Changes saved.</Banner>}
    {result && !creatingService && <Banner tone="critical"><p>{result.error}</p>{Object.entries(result.fields).map(([name, errors]) => errors?.map(error => <p key={name + error}>{name}: {error}</p>))}</Banner>}
    {!creatingService && <div className={open ? "bn-editor-layout" : undefined}><Card padding="0"><BlockStack gap="0">
      <div className="bn-heading-row" style={{ padding: "var(--bn-space-4)" }}><Text as="h2" variant="headingMd">{title}</Text><Button variant="primary" url="?new=1">+ Create</Button></div>
      <Tabs tabs={[{ id: "active", content: "Active" }, { id: "archived", content: "Archived" }]} selected={tab === "active" ? 0 : 1} onSelect={index => setTab(index === 0 ? "active" : "archived")} />
      <div style={{ padding: "var(--bn-space-4)" }}><TextField label="Search" labelHidden value={query} onChange={setQuery} placeholder={"Search by name or email"} autoComplete="off" /></div>
      {!visible.length ? <div style={{ padding: "var(--bn-space-4)" }}><EmptyState heading={rows.length ? "No matches" : "Add your first " + noun.toLowerCase()}
        image="https://cdn.shopify.com/s/files/1/0757/9955/files/empty-state.svg" action={rows.length ? undefined : { content: "+ Create", url: "?new=1" }}>
        <p>{rows.length ? "Try a different search or switch tabs." : "Get started by adding a " + noun.toLowerCase() + "."}</p>
      </EmptyState></div> : <BlockStack gap="0">
        {visible.map(row => <article className="bn-record" key={row.id}>
          <div className="bn-record-head">
            <Button onClick={() => navigate("?edit=" + row.id)}>{row.title}</Button>
            <div className="bn-record-badges">
              <Badge tone={row.active ? "success" : undefined}>{row.active ? "Active" : "Archived"}</Badge>
              {kind === "availabilities" && row.active && !row.values.hasHours && <Badge tone="warning">No working hours set</Badge>}
            </div>
          </div>
          <p className="bn-record-meta">{row.summary}</p>
          {kind === "services" && <p className="bn-record-id">ID: <code>{row.id}</code></p>}
          <div className="bn-record-actions">
            {kind === "availabilities" && row.active && <Button variant={row.values.hasHours ? undefined : "primary"} url={"/app/schedules?staffId=" + row.id}>Set working hours</Button>}
            <RecordAction id={row.id} intent={row.active ? "archive" : "restore"}>{row.active ? "Archive" : "Restore"}</RecordAction>
          </div>
        </article>)}
        {rows.length >= 500 && <Text as="p">Showing the first 500 records.</Text>}
      </BlockStack>}
    </BlockStack></Card>
    {open && <Card><Form method="post" className="bn-form" key={edit?.id ?? "new"}>
      <Text as="h2" variant="headingMd">{edit ? "Edit " + edit.title : "Add " + (kind === "availabilities" ? "Availability" : "location")}</Text>
      <input type="hidden" name="intent" value="save" /><input type="hidden" name="id" value={edit?.id ?? ""} />
      {kind === "locations" && <>{field("name", "Location name", "text", "", true)}{field("address", "Address", "textarea")}
        <AdminTimezoneField name="timezone" label="Timezone" value={value.timezone ?? timezone} required /></>}
      {kind === "availabilities" && <>
        {field("firstName", "First name", "text", "", true)}{field("lastName", "Last name", "text", "", true)}
        {field("email", "Email", "email", "", true)}
        <AdminTimezoneField name="timezone" label="Timezone" value={value.timezone ?? timezone} required />
        <MultiField name="locationIds" label="Locations" required selected={submitted?.locationIds ?? edit?.selected ?? []} options={locations} />
        <details><summary>More details (optional)</summary><BlockStack gap="400">
          {field("phone", "Phone", "tel")}
          {field("contactLink", "Contact Link", "url", "", false, "Your meeting or video call link.")}
          {field("imageUrl", "Profile image URL", "url")}{field("bio", "Description", "textarea")}
        </BlockStack></details>
        {edit ? <>
          <Text as="h3" variant="headingSm">Weekly hours</Text>
          <WeeklyHoursTable ownerKind="staffId" ownerId={edit.id} timezone={edit.values.timezone || timezone} rules={rules} />
          <Link to={"/app/schedules?staffId=" + edit.id}>Add time off or one-off extra hours</Link>
        </> : <p className="bn-muted">Save this Availability first, then set their weekly hours here.</p>}
      </>}
      {kind === "services" && edit && <>
        {field("title", "Event/Service name", "text", "", true)}
        <input type="hidden" name="slug" value={value.slug ?? ""} />
        {locations.length > 1
          ? <SelectField name="locationId" label="Location" value={value.locationId} options={locations} required />
          : <input type="hidden" name="locationId" value={locations[0]?.value ?? ""} />}
        <MultiField name="staffIds" label="Availabilities" required selected={submitted?.staffIds ?? edit?.selected ?? []} options={staff} />
        <div className="bn-form-grid">{field("durationMin", "Duration (minutes)", "number", "60", true)}{field("capacity", "Seats per time", "number", "1", true)}</div>
        <ProductSetup initialVariant={value.variantId ?? ""} initialPrice={value.price ?? "0.00"} creationKey={submitted?.creationKey || creationKey} initialMode={value.productMode === "new" ? "new" : "existing"} currency={currency} errors={result?.fields} />
        <details><summary>Advanced settings (optional)</summary><BlockStack gap="400">
          {field("description", "Description", "textarea")}
          {field("slotIntervalMin", "Slot interval (minutes)", "number", "", false, "Leave blank to offer starts at the Event/Service duration.")}
          <div className="bn-form-grid">{field("bufferBefore", "Buffer before (minutes)", "number", "0")}{field("bufferAfter", "Buffer after (minutes)", "number", "0")}</div>
          <SelectField name="depositType" label="Payment" value={value.depositType ?? "NONE"} options={[{ value: "NONE", label: "Full payment at checkout" }, { value: "FULL", label: "Full payment" }, { value: "FIXED", label: "Fixed deposit" }, { value: "PERCENT", label: "Percentage deposit" }]} />
          {field("depositValue", "Deposit amount or percentage", "text", "0")}
          <div className="bn-form-grid">{field("minNoticeHours", "Minimum notice (hours)", "number", "1")}{field("maxAdvanceDays", "Booking window (days)", "number", "60")}</div>
          <div className="bn-form-grid">{field("customerCancelCutoffHours", "Customer cancellation cutoff (hours)", "number", "0", false, "Customers can cancel until this many hours before the booking.")}
          {field("customerRescheduleCutoffHours", "Customer reschedule cutoff (hours)", "number", "0", false, "Customers can reschedule until this many hours before the booking.")}</div>
        </BlockStack></details>
      </>}
      <SaveButton>{edit ? "Save changes" : "Create"}</SaveButton>
      {kind === "services" && edit && value.variantId && <div className="bn-field bn-next-step">
        <Text as="h3" variant="headingSm">Next: add the booking widget to your storefront</Text>
        <Button loading={themeLink.state !== "idle"} disabled={themeLink.state !== "idle"}
          onClick={() => themeLink.load("/app/catalog/theme-link?variantId=" + encodeURIComponent(value.variantId!))}>
          Add booking widget to theme
        </Button>
        <small>Opens the theme editor on your product template with the booking block ready to add. If the preview shows a different product, switch it with the product selector at the top — the block still applies to every product linked to a BookNest service.</small>
      </div>}
    </Form></Card>}</div>}
    {creatingService && <ServiceWizard locations={locations} staff={staff} currency={currency} creationKey={creationKey} result={result} onClose={close} />}
  </BlockStack></Page>;
}

const durationPresets = ["15", "30", "45", "60", "90"];
function ServiceWizard({ locations, staff, currency, creationKey, result, onClose }: {
  locations: { value: string; label: string }[]; staff: { value: string; label: string }[]; currency: string; creationKey: string;
  result: ReturnType<typeof useActionData<typeof action>>; onClose: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const totalSteps = 5;
  const [offeringKind, setOfferingKind] = useState<"paid" | "free" | null>(null);
  const [capacityChoice, setCapacityChoice] = useState<"one" | "group">("one");
  const [durationChoice, setDurationChoice] = useState("30");
  const [customDuration, setCustomDuration] = useState("30");
  const duration = durationChoice === "custom" ? customDuration : durationChoice;
  const submitted = result?.submitted ?? null;
  const errors = result?.fields;
  const field = (name: string, label: string, type = "text", fallback = "", required = false, help?: string) =>
    <Field name={name} label={label} type={type} value={submitted?.values[name] ?? fallback} required={required} help={help} errors={errors?.[name]} step={type === "number" ? "1" : undefined} />;
  const stepTitles = ["What kind of Event/Service do you want to create?", "Basic details", "Set up your time slots", "Availabilities", "Pricing and policies"];
  return <Card><BlockStack gap="400">
      <div className="bn-heading-row"><Text as="h2" variant="headingMd">Create an Event/Service</Text><Button variant="plain" onClick={onClose}>Cancel</Button></div>
      <p className="bn-wizard-step">Step {step} of {totalSteps}</p>
      <Text as="h3" variant="headingSm">{stepTitles[step - 1]}</Text>
      <Form method="post" className="bn-form" ref={formRef}>
        <input type="hidden" name="intent" value="save" /><input type="hidden" name="id" value="" />
        <div style={{ display: step === 1 ? undefined : "none" }}><BlockStack gap="400">
          <div className="bn-choice-cards" data-columns="2">
            <AdminChoiceCard name="offeringKindChoice" value="paid" label="Paid service" description="Customers pay when they book, in full or as a deposit." checked={offeringKind === "paid"} onSelect={() => setOfferingKind("paid")} />
            <AdminChoiceCard name="offeringKindChoice" value="free" label="Free booking" description="No charge at checkout. You can still collect payment another way." checked={offeringKind === "free"} onSelect={() => setOfferingKind("free")} />
          </div>
        </BlockStack></div>
        <div style={{ display: step === 2 ? undefined : "none" }}><BlockStack gap="400">
          {field("title", "Event/Service name", "text", "", true)}
          {locations.length > 1
            ? <SelectField name="locationId" label="Location" options={locations} required />
            : <input type="hidden" name="locationId" value={locations[0]?.value ?? ""} />}
        </BlockStack></div>
        <div style={{ display: step === 3 ? undefined : "none" }}><BlockStack gap="400">
          <Text as="p" fontWeight="semibold">Appointment length</Text>
          <div className="bn-pill-group">
            {durationPresets.map(value => <Button key={value} pressed={durationChoice === value} onClick={() => setDurationChoice(value)}>{value} min</Button>)}
            <Button pressed={durationChoice === "custom"} onClick={() => setDurationChoice("custom")}>Custom</Button>
          </div>
          {durationChoice === "custom" && <TextField label="Custom duration (minutes)" type="number" value={customDuration} onChange={setCustomDuration} autoComplete="off" />}
          <input type="hidden" name="durationMin" value={duration} />
          <Text as="p" fontWeight="semibold">How many people can book each slot?</Text>
          <div className="bn-choice-cards" data-columns="2">
            <AdminChoiceCard name="capacityChoice" value="one" label="One-on-one" description="One customer per slot." checked={capacityChoice === "one"} onSelect={() => setCapacityChoice("one")} />
            <AdminChoiceCard name="capacityChoice" value="group" label="Group" description="Multiple customers per slot." checked={capacityChoice === "group"} onSelect={() => setCapacityChoice("group")} />
          </div>
          {capacityChoice === "group" ? field("capacity", "Seats per time", "number", "4", true) : <input type="hidden" name="capacity" value="1" />}
          {field("slotIntervalMin", "Slot interval (minutes)", "number", "", false, "Leave blank to offer starts at the Event/Service duration.")}
          <div className="bn-form-grid">{field("bufferBefore", "Buffer before (minutes)", "number", "0")}{field("bufferAfter", "Buffer after (minutes)", "number", "0")}</div>
        </BlockStack></div>
        <div style={{ display: step === 4 ? undefined : "none" }}>
          <MultiField name="staffIds" label="Availabilities" required selected={submitted?.staffIds ?? []} options={staff} />
        </div>
        <div style={{ display: step === 5 ? undefined : "none" }}><BlockStack gap="400">
          {offeringKind === "paid" ? <ProductSetup initialVariant="" initialPrice="0.00" creationKey={submitted?.creationKey || creationKey} initialMode="existing" currency={currency} errors={errors} />
            : <><input type="hidden" name="price" value="0.00" /><input type="hidden" name="productMode" value="existing" /><input type="hidden" name="variantId" value="" /><input type="hidden" name="creationKey" value={submitted?.creationKey || creationKey} /><p>This will be a free booking. No payment is collected at checkout.</p></>}
          {offeringKind === "paid" && <><SelectField name="depositType" label="Payment" value="NONE" options={[{ value: "NONE", label: "Full payment at checkout" }, { value: "FULL", label: "Full payment" }, { value: "FIXED", label: "Fixed deposit" }, { value: "PERCENT", label: "Percentage deposit" }]} />
            {field("depositValue", "Deposit amount or percentage", "text", "0")}</>}
          <div className="bn-form-grid">{field("minNoticeHours", "Minimum notice (hours)", "number", "1")}{field("maxAdvanceDays", "Booking window (days)", "number", "60")}</div>
          <div className="bn-form-grid">{field("customerCancelCutoffHours", "Customer cancellation cutoff (hours)", "number", "0", false, "Customers can cancel until this many hours before the booking.")}
          {field("customerRescheduleCutoffHours", "Customer reschedule cutoff (hours)", "number", "0", false, "Customers can reschedule until this many hours before the booking.")}</div>
          <details><summary>More details (optional)</summary>{field("description", "Description", "textarea")}</details>
        </BlockStack></div>
        {result && <Banner tone="critical"><p>{result.error}</p>{Object.entries(result.fields).map(([name, fieldErrors]) => fieldErrors?.map(error => <p key={name + error}>{name}: {error}</p>))}</Banner>}
        <div className="bn-heading-row">
          {step > 1 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <span />}
          {step === totalSteps
            ? <Button variant="primary" onClick={() => formRef.current?.requestSubmit()}>Create</Button>
            : <Button variant="primary" disabled={step === 1 && !offeringKind} onClick={() => setStep(step + 1)}>Continue</Button>}
        </div>
      </Form>
  </BlockStack></Card>;
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
  // Already linked to a product: keep the picker collapsed so editing an unrelated field can't accidentally relink it.
  const [locked, setLocked] = useState(Boolean(initialVariant) && !errors?.variantId?.length);
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
    {locked ? <div className="bn-field">
      <input type="hidden" name="productMode" value={mode} /><input type="hidden" name="variantId" value={variantId} />
      <p>✓ Already linked to a Shopify product.</p>
      <Button onClick={() => setLocked(false)}>Change linked product</Button>
    </div> : <>
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
    </>}
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
