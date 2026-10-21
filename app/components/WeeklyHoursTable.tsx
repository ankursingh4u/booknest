import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Text, TextField, Button, BlockStack } from "@shopify/polaris";
import { AdminTimezoneField } from "./AdminFields";

const dayOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const rulesEndpoint = "/app/catalog/rules";

function TimeField({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  const [value, setValue] = useState(defaultValue);
  return <TextField labelHidden label={label} type="time" name={name} value={value} onChange={setValue} autoComplete="off" />;
}

type Rule = { id: string; staffId: string | null; serviceId: string | null; weekday: number; startTime: string; endTime: string };

function ExistingSlotRow({ rule }: { rule: Rule }) {
  const saveFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const busy = saveFetcher.state !== "idle" || deleteFetcher.state !== "idle";
  return <div className="bn-week-slot">
    <saveFetcher.Form method="post" action={rulesEndpoint} className="bn-week-slot-times">
      <input type="hidden" name="intent" value="rule.update" /><input type="hidden" name="id" value={rule.id} />
      <TimeField name="startTime" label="Start time" defaultValue={rule.startTime} />
      <Text as="span">–</Text>
      <TimeField name="endTime" label="End time" defaultValue={rule.endTime} />
      <Button submit size="slim" loading={busy} disabled={busy}>Save</Button>
    </saveFetcher.Form>
    <deleteFetcher.Form method="post" action={rulesEndpoint}>
      <input type="hidden" name="intent" value="rule.delete" /><input type="hidden" name="id" value={rule.id} />
      <Button submit size="slim" tone="critical" loading={busy} disabled={busy}>Delete</Button>
    </deleteFetcher.Form>
  </div>;
}

function NewSlotRow({ ownerKind, ownerId, weekday, timezone, onDone }: {
  ownerKind: "staffId" | "serviceId"; ownerId: string; weekday: number; timezone: string; onDone: () => void;
}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !("error" in (fetcher.data as object))) onDone();
  }, [fetcher.state, fetcher.data]);
  return <fetcher.Form method="post" action={rulesEndpoint} className="bn-week-slot">
    <input type="hidden" name="intent" value="rule.save" /><input type="hidden" name={ownerKind} value={ownerId} />
    <input type="hidden" name="weekday" value={weekday} /><input type="hidden" name="timezone" value={timezone} />
    <div className="bn-week-slot-times">
      <TimeField name="startTime" label="Start time" defaultValue="09:00" />
      <Text as="span">–</Text>
      <TimeField name="endTime" label="End time" defaultValue="17:00" />
    </div>
    <Button submit size="slim" variant="primary" loading={busy} disabled={busy}>Add</Button>
    <Button size="slim" onClick={onDone} disabled={busy}>Cancel</Button>
    {fetcher.data && "error" in (fetcher.data as object) && <Text as="span" tone="critical">{(fetcher.data as { error: string }).error}</Text>}
  </fetcher.Form>;
}

export function WeeklyHoursTable({ ownerKind, ownerId, timezone, rules }: {
  ownerKind: "staffId" | "serviceId"; ownerId: string; timezone: string; rules: Rule[];
}) {
  const [zone, setZone] = useState(timezone);
  const [addingDay, setAddingDay] = useState<number | null>(null);
  const ownerRules = rules.filter(rule => rule[ownerKind] === ownerId);
  return <BlockStack gap="400">
    <AdminTimezoneField name="viewTimezone" label="Timezone for new hours" value={zone} onChangeValue={setZone} required />
    <div className="bn-week-table">
      {dayOrder.map(weekday => {
        const dayRules = ownerRules.filter(rule => rule.weekday === weekday).sort((a, b) => a.startTime.localeCompare(b.startTime));
        return <div className="bn-week-row" key={weekday}>
          <div className="bn-week-day">{weekdays[weekday]}</div>
          <div className="bn-week-slots">
            {dayRules.map(rule => <ExistingSlotRow key={rule.id} rule={rule} />)}
            {dayRules.length > 0 && addingDay !== weekday && <Button variant="plain" onClick={() => setAddingDay(weekday)}>+ Add another time range</Button>}
            {dayRules.length === 0 && addingDay !== weekday &&
              <button type="button" className="bn-week-unavailable" onClick={() => setAddingDay(weekday)}>Unavailable (Click to add timeslot)</button>}
            {addingDay === weekday && <NewSlotRow ownerKind={ownerKind} ownerId={ownerId} weekday={weekday} timezone={zone} onDone={() => setAddingDay(null)} />}
          </div>
        </div>;
      })}
    </div>
  </BlockStack>;
}
