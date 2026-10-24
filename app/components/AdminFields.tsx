import { useState, type ReactNode } from "react";
import { Form, useFetcher, useNavigation } from "react-router";
import { TextField, Select, ChoiceList, Checkbox, Button, Labelled } from "@shopify/polaris";

type TextFieldType = "text" | "email" | "number" | "password" | "search" | "tel" | "url" | "date" | "datetime-local" | "month" | "time" | "week";

export function AdminField({ name, label, type = "text", value = "", required = false, help, errors, children, step }: {
  name: string; label: string; type?: string; value?: string | number; required?: boolean;
  help?: string; errors?: string[]; children?: ReactNode; step?: string | number;
}) {
  const [current, setCurrent] = useState(value === undefined || value === null ? "" : String(value));
  if (children) {
    return <Labelled id={name} label={label} helpText={help} error={errors?.[0]} requiredIndicator={required}>{children}</Labelled>;
  }
  if (type === "textarea") {
    return <TextField label={label} name={name} id={name} value={current} onChange={setCurrent} multiline={3}
      autoComplete="off" requiredIndicator={required} helpText={help} error={errors?.[0]} />;
  }
  return <TextField label={label} name={name} id={name} type={type as TextFieldType} value={current} onChange={setCurrent}
    autoComplete="off" requiredIndicator={required} helpText={help} error={errors?.[0]} step={step === undefined ? undefined : Number(step)} />;
}

export function AdminSelectField({ name, label, value = "", options, required = false }: {
  name: string; label: string; value?: string; options: { value: string; label: string }[]; required?: boolean;
}) {
  const [current, setCurrent] = useState(value);
  return <Select label={label} name={name} id={name} value={current} onChange={setCurrent} requiredIndicator={required}
    options={[{ value: "", label: "Choose…" }, ...options]} />;
}

// Picking one of these two selects clears the other, since the server only accepts exactly one.
export function AdminEitherSelectField({ firstName, firstLabel, firstValue = "", firstOptions, secondName, secondLabel, secondValue = "", secondOptions, onFirstChange, onSecondChange }: {
  firstName: string; firstLabel: string; firstValue?: string; firstOptions: { value: string; label: string }[];
  secondName: string; secondLabel: string; secondValue?: string; secondOptions: { value: string; label: string }[];
  onFirstChange?: (value: string) => void; onSecondChange?: (value: string) => void;
}) {
  const [first, setFirst] = useState(firstValue);
  const [second, setSecond] = useState(secondValue);
  return <>
    <Select label={firstLabel} name={firstName} id={firstName} value={first}
      onChange={value => { setFirst(value); if (value) setSecond(""); onFirstChange?.(value); if (value) onSecondChange?.(""); }}
      options={[{ value: "", label: "Choose…" }, ...firstOptions]} />
    <Select label={secondLabel} name={secondName} id={secondName} value={second}
      onChange={value => { setSecond(value); if (value) setFirst(""); onSecondChange?.(value); if (value) onFirstChange?.(""); }}
      options={[{ value: "", label: "Choose…" }, ...secondOptions]} />
  </>;
}

// One representative IANA zone per distinct UTC offset currently in use worldwide (~38),
// instead of every city Intl.supportedValuesOf("timeZone") returns (~400, mostly duplicates
// of the same offset/DST rules). The IANA name is still what's stored, so DST stays correct.
const representativeTimezones = [
  "Etc/GMT+12", "Pacific/Pago_Pago", "Pacific/Honolulu", "Pacific/Marquesas", "America/Anchorage",
  "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Halifax",
  "America/St_Johns", "America/Sao_Paulo", "Atlantic/South_Georgia", "Atlantic/Azores", "Europe/London",
  "Europe/Paris", "Africa/Cairo", "Europe/Moscow", "Asia/Tehran", "Asia/Dubai", "Asia/Kabul",
  "Asia/Karachi", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Dhaka", "Asia/Yangon", "Asia/Bangkok",
  "Asia/Shanghai", "Asia/Singapore", "Australia/Eucla", "Asia/Tokyo", "Australia/Adelaide",
  "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Noumea", "Pacific/Auckland", "Pacific/Chatham",
  "Pacific/Tongatapu", "Pacific/Kiritimati",
];
const offsetLabel = (zone: string) => {
  try { return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value ?? ""; }
  catch { return ""; }
};
const timezoneOptions = representativeTimezones.map(zone => ({ value: zone, label: zone.replaceAll("_", " ") + " (" + offsetLabel(zone) + ")" }));
export function AdminTimezoneField({ name, label, value = "", required = false, help, onChangeValue }: {
  name: string; label: string; value?: string; required?: boolean; help?: string; onChangeValue?: (value: string) => void;
}) {
  const [current, setCurrent] = useState(value);
  return <Select label={label} name={name} id={name} value={current} onChange={value => { setCurrent(value); onChangeValue?.(value); }} requiredIndicator={required} helpText={help}
    options={[{ value: "", label: "Choose…" }, ...timezoneOptions]} />;
}

export function AdminMultiField({ name, label, selected, options, required = false }: {
  name: string; label: string; selected: string[]; options: { value: string; label: string }[]; required?: boolean;
}) {
  const [current, setCurrent] = useState(selected);
  const title = required ? label + " *" : label;
  if (!options.length) return <Labelled id={name} label={title}><p>Add a record first.</p></Labelled>;
  return <>
    {/* ChoiceList with allowMultiple submits as "name[]", not "name" - supply the real field via hidden inputs instead. */}
    {current.map(value => <input key={value} type="hidden" name={name} value={value} />)}
    <ChoiceList title={title} allowMultiple selected={current} onChange={setCurrent}
      choices={options.map(option => ({ value: option.value, label: option.label }))} />
  </>;
}

export function AdminCheckbox({ name, label, value, defaultChecked = false, onToggle }: {
  name: string; label: ReactNode; value?: string; defaultChecked?: boolean; onToggle?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  return <Checkbox label={label} name={name} value={value} checked={checked}
    onChange={next => { setChecked(next); onToggle?.(next); }} />;
}

export function AdminButton({ children, onClick, disabled = false, loading = false, variant, type = "button" }: {
  children: string; onClick?: () => void; disabled?: boolean; loading?: boolean; variant?: "primary" | "secondary" | "tertiary" | "plain"; type?: "button" | "submit";
}) {
  return <Button onClick={onClick} disabled={disabled} loading={loading} variant={variant} submit={type === "submit"}>{children}</Button>;
}

export function AdminSaveButton({ children = "Save", variant = "primary" }: { children?: string; variant?: "primary" | "secondary" }) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return <Button submit variant={variant === "primary" ? "primary" : undefined} loading={busy}>{busy ? "Saving…" : children}</Button>;
}

export function AdminChoiceCard({ name, value, label, description, checked, onSelect }: {
  name: string; value: string; label: string; description?: string; checked: boolean; onSelect: () => void;
}) {
  return <label className="bn-choice-card" data-selected={checked}>
    <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} />
    <span><strong>{label}</strong>{description && <span>{description}</span>}</span>
  </label>;
}

export function AdminRecordAction({ id, intent, children, variant = "primary" }: { id: string; intent: string; children: string; variant?: "primary" | "secondary" }) {
  // Submit through a fetcher so the request goes via App Bridge's authenticated fetch. A plain
  // <Form> POST is a document navigation, which an embedded app cannot re-authenticate (the
  // "Unable to continue" screen); a fetcher request carries the session token and is retried.
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  return <fetcher.Form method="post">
    <input type="hidden" name="id" value={id} /><input type="hidden" name="intent" value={intent} />
    <Button submit variant={variant === "primary" ? "primary" : undefined} loading={busy}>{busy ? "Working…" : children}</Button>
  </fetcher.Form>;
}
