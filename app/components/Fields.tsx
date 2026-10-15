import type { ReactNode } from "react";
import { Form, useNavigation } from "react-router";
export function Field({ name, label, type = "text", value = "", required = false, help, errors, children, step }: {
  name: string; label: string; type?: string; value?: string | number; required?: boolean;
  help?: string; errors?: string[]; children?: ReactNode; step?: string;
}) {
  return <div className="bn-field"><label htmlFor={name}>{label}</label>
    {children ?? (type === "textarea" ? <textarea id={name} name={name} defaultValue={value} rows={3} />
      : <input id={name} name={name} type={type} defaultValue={value} required={required} step={step}
        aria-invalid={Boolean(errors?.length)} aria-describedby={errors?.length ? name + "-error" : help ? name + "-help" : undefined} />)}
    {help && <small id={name + "-help"}>{help}</small>}
    {errors?.map(error => <p className="bn-error" id={name + "-error"} key={error}>{error}</p>)}
  </div>;
}
export function SelectField({ name, label, value = "", options, required = false }: {
  name: string; label: string; value?: string; options: { value: string; label: string }[]; required?: boolean;
}) {
  return <Field name={name} label={label}><select id={name} name={name} defaultValue={value} required={required}>
    <option value="">Choose…</option>{options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
  </select></Field>;
}
export function MultiField({ name, label, selected, options }: {
  name: string; label: string; selected: string[]; options: { value: string; label: string }[];
}) {
  return <fieldset className="bn-options"><legend>{label}</legend>{options.length ? options.map(option =>
    <label key={option.value}><input type="checkbox" name={name} value={option.value} defaultChecked={selected.includes(option.value)} />{option.label}</label>)
    : <p>Add a record first.</p>}</fieldset>;
}
export function SaveButton({ children = "Save" }: { children?: ReactNode }) {
  const navigation = useNavigation();
  return <button className="bn-primary-link" type="submit" disabled={navigation.state !== "idle"}>{navigation.state !== "idle" ? "Saving…" : children}</button>;
}
export function RecordAction({ id, intent, children }: { id: string; intent: string; children: ReactNode }) {
  return <Form method="post"><input type="hidden" name="id" value={id} /><input type="hidden" name="intent" value={intent} /><SaveButton>{children}</SaveButton></Form>;
}
