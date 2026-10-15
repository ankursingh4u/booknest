const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT"]);
function attribute(node, key) {
  const attributes = node.attributes ?? [];
  const index = attributes.indexOf(key);
  return index < 0 ? null : attributes[index + 1];
}
function text(node) {
  if (ignoredTags.has(node.nodeName)) return "";
  return (node.nodeType === 3 ? node.nodeValue ?? "" : "") + (node.children ?? []).map(text).join("");
}
function walk(node, visit) {
  if (!node || ignoredTags.has(node.nodeName)) return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
  for (const root of node.shadowRoots ?? []) walk(root, visit);
  if (node.contentDocument) walk(node.contentDocument, visit);
}
function slotContainers(root) {
  const containers = [];
  walk(root, (node) => {
    if ((attribute(node, "class") ?? "").split(/\s+/).includes("servicify-slots-scroll")) containers.push(node);
  });
  return containers;
}
function isDisabled(row) {
  return ["disabled", "hidden", "inert"].some((key) => attribute(row, key) !== null)
    || attribute(row, "aria-disabled") === "true" || attribute(row, "aria-hidden") === "true";
}
function capacity(row) {
  let badge = null;
  walk(row, (node) => {
    if (attribute(node, "data-servicify") === "num-available-attendees") badge = node;
  });
  const match = badge && text(badge).match(/^\s*(\d+)\s*\/\s*(\d+)\s+available\s*$/i);
  return match ? Number(match[1]) : 0;
}

/** Select actual slot-row parents, never arbitrary text spans or page-wide matches. */
export function findAvailableSlotRows(root) {
  return slotContainers(root).flatMap((container) => (container.children ?? []).filter((row) =>
    ["DIV", "BUTTON", "LI"].includes(row.nodeName)
    && !isDisabled(row) && capacity(row) > 0
    && /^\s*\d{1,2}:\d{2}(?:\s*[AP]M)?/i.test(text(row))));
}

/** A changed render is necessary before confirmation; the cart response remains the completion gate. */
export function hasSlotSelectionChanged(before, root) {
  const after = slotContainers(root).flatMap((container) => container.children ?? []).find((row) =>
    row.backendNodeId === before.backendNodeId || text(row) === text(before));
  if (!after || isDisabled(after)) return false;
  for (const key of ["aria-selected", "aria-pressed", "data-selected", "data-active"]) {
    if (attribute(after, key) === "true" && attribute(before, key) !== "true") return true;
  }
  return ["class", "style"].some((key) => attribute(after, key) !== attribute(before, key));
}

/** Telemetry, 4xx responses, and missing request/response bodies cannot prove a booking cart was created. */
export function getSuccessfulCartCapture(requests) {
  for (const request of requests) {
    let url;
    try { url = new URL(request.url); } catch { continue; }
    if (url.hostname !== "yogababble.myshopify.com" || !/(?:^|\/)cart\/add\.js$/.test(url.pathname)
      || request.method !== "POST" || !Number.isInteger(request.status) || request.status < 200 || request.status >= 300
      || !request.postData || !request.responseBody) continue;
    try {
      const input = JSON.parse(request.postData);
      const output = JSON.parse(request.responseBody);
      const added = Array.isArray(output.items) ? output.items : output.id ? [output] : [];
      if (!Array.isArray(input.items) || !input.items.length) continue;
      if (input.items.every((item) => item.id && item.quantity > 0 && item.properties
        && Object.keys(item.properties).length > 0
        && added.some((line) => String(line.variant_id ?? line.id) === String(item.id)
          && line.quantity >= item.quantity
          && Object.entries(item.properties).every(([key, value]) => line.properties?.[key] === value)))) return request;
    } catch { /* Malformed or incomplete records are not completion evidence. */ }
  }
  return null;
}

/** The saved source renders this marker only when a time is selected. */
export function findBookingCartButton(root) {
  const matches = new Set();
  walk(root, (node) => {
    if (!(attribute(node, "class") ?? "").split(/\s+/).includes("servicify-modal-portal")) return;
    walk(node, (candidate) => {
      if (candidate.nodeName === "BUTTON"
        && attribute(candidate, "data-servicify") === "servicify-add-to-cart-button"
        && !isDisabled(candidate)) matches.add(candidate);
    });
  });
  return matches.size === 1 ? [...matches][0] : null;
}
