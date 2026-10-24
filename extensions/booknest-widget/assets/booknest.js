(() => {
  "use strict";
  // Civil calendar math deliberately avoids timezone-dependent Date arithmetic.
  const pad = value => String(value).padStart(2, "0");
  const daysInMonth = (year, month) => [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  function monthDates(month) {
    const [year, number] = month.split("-").map(Number);
    return Array.from({ length: daysInMonth(year, number) }, (_, index) => month + "-" + pad(index + 1));
  }
  function shiftMonth(month, count) {
    const [year, number] = month.split("-").map(Number);
    const ordinal = year * 12 + number - 1 + count;
    return Math.floor(ordinal / 12) + "-" + pad((ordinal % 12 + 12) % 12 + 1);
  }
  function shiftDay(date, count) {
    let [year, month, day] = date.split("-").map(Number);
    day += count;
    while (day < 1) { month--; if (month < 1) { month = 12; year--; } day += daysInMonth(year, month); }
    while (day > daysInMonth(year, month)) { day -= daysInMonth(year, month); month++; if (month > 12) { month = 1; year++; } }
    return year + "-" + pad(month) + "-" + pad(day);
  }
  function weekday(date) {
    let [year, month, day] = date.split("-").map(Number);
    if (month < 3) year--;
    return (year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4][month - 1] + day) % 7;
  }
  function calendarKeyDate(date, key) {
    const increments = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday(date), End: 6 - weekday(date) };
    if (Object.prototype.hasOwnProperty.call(increments, key)) return shiftDay(date, increments[key]);
    if (key === "PageUp" || key === "PageDown") {
      const month = shiftMonth(date.slice(0, 7), key === "PageUp" ? -1 : 1);
      const [year, number] = month.split("-").map(Number);
      return month + "-" + pad(Math.min(Number(date.slice(8)), daysInMonth(year, number)));
    }
    return null;
  }
  function activeVariant({ formVariant, urlVariant, fallback, productVariants }) {
    return [formVariant, urlVariant, fallback].map(value => String(value || "")).find(value => productVariants.includes(value)) || "";
  }
  function variantGate(id, productVariants, status) {
    if (!id || !productVariants.includes(id)) return "pass";
    return status.has(id) ? status.get(id) ? "book" : "pass" : "resolve";
  }
  function variantResolver(loader, allowed) {
    const pending = new Map(), results = new Map(), status = new Map();
    // When `allowed` (the product's variant ids) is given, a service linked to ANY of them counts as
    // bookable from any selected variant; otherwise fall back to matching only the loaded variant.
    const keep = (service, id) => service.variantId == null
      || (allowed ? allowed.includes(String(service.variantId).split("/").pop()) : String(service.variantId).split("/").pop() === id);
    return {
      status,
      load(id) {
        if (results.has(id)) return Promise.resolve(results.get(id));
        if (pending.has(id)) return pending.get(id);
        const promise = Promise.resolve().then(() => loader(id)).then(data => {
          const matching = { ...data, services: data.services.filter(service => keep(service, id)) };
          results.set(id, matching); status.set(id, matching.services.length > 0); return matching;
        }).finally(() => pending.delete(id));
        pending.set(id, promise);
        return promise;
      }
    };
  }
  function parseThemeColor(value) {
    const trimmed = (value || "").trim();
    if (/^#[a-fA-F0-9]{6}$/.test(trimmed)) return trimmed;
    if (/^#[a-fA-F0-9]{3}$/.test(trimmed)) {
      const [r, g, b] = trimmed.slice(1).split("");
      return "#" + r + r + g + g + b + b;
    }
    const rgbMatch = trimmed.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    const channels = rgbMatch ? [rgbMatch[1], rgbMatch[2], rgbMatch[3]]
      : /^[\d.]+(?:[,\s]+[\d.]+){2}$/.test(trimmed) ? trimmed.split(/[,\s]+/) : null;
    if (!channels || channels.some(channel => Number.isNaN(Number(channel)))) return null;
    const toHex = channel => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, "0");
    return "#" + channels.map(toHex).join("");
  }
  function accentPresentation(hex, dark = false) {
    const luminance = color => {
      const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255)
        .map(channel => channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const accent = /^#[a-fA-F0-9]{6}$/.test(hex || "") ? hex : "#253f8e";
    const value = luminance(accent), background = luminance(dark ? "#17191c" : "#ffffff");
    const contrast = (Math.max(value, background) + 0.05) / (Math.min(value, background) + 0.05);
    return { foreground: 1.05 / (value + 0.05) >= (value + 0.05) / 0.05 ? "#ffffff" : "#000000",
      focus: contrast >= 3 ? accent : dark ? "#ffffff" : "#202223" };
  }
  function isHoldActive(hold, now = Date.now()) {
    const expiry = hold && Date.parse(hold.expiresAt);
    return Number.isFinite(expiry) && expiry > now;
  }
  function claimNativeForm(form, root, owners, release) {
    const owner = owners.get(form);
    if (owner && owner.root !== root) {
      if (owner.root.isConnected) return false;
      owner.release(form);
    }
    owners.set(form, { root, release });
    return true;
  }
  function setNativeVisibility(button, linked, history) {
    if (linked) {
      if (!history.has(button)) history.set(button, { hidden: button.hidden, display: button.style.getPropertyValue("display"), priority: button.style.getPropertyPriority("display") });
      button.hidden = true; button.style.setProperty("display", "none", "important");
    } else if (history.has(button)) {
      const original = history.get(button);
      button.hidden = original.hidden;
      if (original.display) button.style.setProperty("display", original.display, original.priority);
      else button.style.removeProperty("display");
      history.delete(button);
    }
  }
  function nativeReplacementActive(actions) {
    for (const action of actions) if (!action.hidden) return true;
    return false;
  }
  function placeNativeAction(nativeForm, action, anchor) {
    if (anchor) anchor.before(action); else nativeForm.append(action);
  }
  const core = { activeVariant, variantGate, variantResolver, monthDates, shiftMonth, shiftDay, weekday, calendarKeyDate, claimNativeForm, isHoldActive, accentPresentation, parseThemeColor, setNativeVisibility, nativeReplacementActive, placeNativeAction, request };
  if (typeof document === "undefined" && typeof module !== "undefined" && module.exports) { module.exports = core; return; }
  if (window.__booknestLoaded) return;
  window.__booknestLoaded = true;
  const nativeOwners = new WeakMap();
  const make = (tag, text, attributes = {}) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  };
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
      let data;
      try { data = await response.json(); } catch { throw new Error("The store returned an unexpected response. Please retry."); }
      if (!response.ok) throw Object.assign(new Error(data.error || data.description || "Unable to complete your request."), { status: response.status });
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The request timed out. Please retry.");
      throw error;
    } finally { clearTimeout(timer); }
  }
  const locale = document.documentElement.lang || "en";
  const localRoot = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  const api = localRoot + "apps/booknest";
  const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const todayInZone = zone => { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const part = name => parts.find(value => value.type === name).value; return part("year") + "-" + part("month") + "-" + part("day"); };
  const civilLabel = (date, options) => new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(date + "T12:00:00Z"));
  function initialize(root) {
    if (root.dataset.initialized) return;
    root.dataset.initialized = "true";
    const prefix = "bn-" + (root.dataset.blockId || crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, "");
    const defaultAccent = "#253f8e";
    const configuredAccent = /^#[a-fA-F0-9]{6}$/.test(root.dataset.accent || "") ? root.dataset.accent : defaultAccent;
    // Merchants who never touched the Accent setting get the theme's own button color automatically, matching native buttons instead of a fixed app blue.
    const themeAccent = configuredAccent === defaultAccent ? parseThemeColor(getComputedStyle(root).getPropertyValue("--color-button")) : null;
    const effectiveAccent = themeAccent || configuredAccent;
    root.style.setProperty("--bn-accent", effectiveAccent);
    const accent = accentPresentation(effectiveAccent, root.dataset.theme === "contrast");
    root.style.setProperty("--bn-on-accent", accent.foreground); root.style.setProperty("--bn-focus", accent.focus);
    let catalog, chosen, selected, busy = false, catalogVersion = 0, slotVersion = 0, calendarVersion = 0, idempotencyKey = crypto.randomUUID();
    let questionInputs = [], visibleSlots = [], availableDays = new Map(), month = "", earliest = "", latest = "", returnFocus;
    let checkoutHold = null, checkoutFailed = false, expiryTimer;
    let time24 = false, currentVariantId = "", catalogReady = false, seeking = false;
    try { time24 = localStorage.getItem("booknest:24h") === "true"; } catch {}
    const productVariants = (root.dataset.productVariants || root.dataset.variantId || "").split(",").filter(Boolean);
    const surface = root.dataset.surface || "booking";
    const popup = root.dataset.mode !== "inline" || surface !== "booking";
    root.replaceChildren();
    const showcase = make("div", null, { class: surface === "collection" ? "bn-service-grid" : "bn-featured" });
    const wrapper = make(popup ? "dialog" : "section", null, { class: "bn-widget" });
    const heading = make("h2", "Book an appointment", { id: prefix + "-heading" });
    wrapper.setAttribute("aria-labelledby", heading.id);
    if (popup) wrapper.setAttribute("aria-modal", "true");
    const close = make("button", "Close", { type: "button", class: "bn-close", "aria-label": "Close booking form" });
    const drag = make("div", null, { class: "bn-drag", "aria-hidden": "true" });
    const trigger = make("button", root.dataset.buttonLabel || "Book a time", { type: "button", class: "bn-primary bn-trigger" });
    function openBooking() {
      heading.after(status, errors, retry);
      if (popup) {
        if (!wrapper.open) {
          returnFocus = document.activeElement;
          if (!returnFocus || returnFocus.closest("[hidden]")) returnFocus = [...nativeActions.values()].find(action => !action.hidden) || trigger;
          wrapper.showModal();
        }
      } else {
        wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
        service.focus({ preventScroll: true });
      }
    }
    if (popup) {
      wrapper.append(drag, close);
      close.addEventListener("click", () => wrapper.close());
      wrapper.addEventListener("cancel", event => { event.preventDefault(); wrapper.close(); });
      wrapper.addEventListener("close", () => { if (returnFocus && returnFocus.isConnected) returnFocus.focus(); });
      let dragStart;
      drag.addEventListener("pointerdown", event => { dragStart = { x: event.clientX, y: event.clientY }; drag.setPointerCapture(event.pointerId); });
      drag.addEventListener("pointerup", event => {
        if (dragStart && event.clientY - dragStart.y > 80 && Math.abs(event.clientX - dragStart.x) < event.clientY - dragStart.y && matchMedia("(max-width: 767px)").matches) wrapper.close();
        dragStart = null;
      });
      drag.addEventListener("pointercancel", () => { dragStart = null; });
    }
    trigger.addEventListener("click", openBooking);
    if (surface === "booking" && popup) root.append(trigger);
    if (surface !== "booking") root.append(showcase);
    const status = make("p", "Loading booking options…", { role: "status", "aria-live": "polite", class: "bn-status" });
    const errors = make("p", "", { role: "alert", class: "bn-error" });
    const retry = make("button", "Retry", { type: "button", class: "bn-secondary", hidden: true });
    let retryAction = null;
    retry.addEventListener("click", async () => {
      const action = retryAction; if (!action) return;
      retry.disabled = true;
      try { await action(); } catch {} finally { retry.disabled = false; }
    });
    const form = make("form", null, { class: "bn-widget-form" });
    const service = make("select", null, { required: true });
    const quantity = make("input", null, { type: "number", min: 1, step: 1, value: 1, required: true, inputmode: "numeric" });
    const details = make("p", "", { class: "bn-details" });
    const timezone = make("select", null, { "aria-label": "Booking timezone" });
    const timeFormat = make("button", time24 ? "24-hour" : "AM/PM", { type: "button", class: "bn-secondary bn-pill-toggle", "aria-label": "Switch time format", "aria-pressed": time24 });
    const calendar = make("section", null, { class: "bn-calendar", "aria-label": "Choose a booking date" });
    const calendarNav = make("div", null, { class: "bn-calendar-nav" });
    const previousMonth = make("button", "‹", { type: "button", class: "bn-secondary", "aria-label": "Previous month" });
    const nextMonth = make("button", "›", { type: "button", class: "bn-secondary", "aria-label": "Next month" });
    const monthHeading = make("h3", "", { id: prefix + "-month", "aria-live": "polite" });
    calendarNav.append(previousMonth, monthHeading, nextMonth);
    const calendarGrid = make("div", null, { class: "bn-calendar-grid", role: "group", "aria-labelledby": monthHeading.id, "aria-describedby": prefix + "-date-instructions" });
    const calendarLegend = make("p", "Choose an available date. Use arrow keys to move, Page Up/Down to change month, and Enter to select. Unavailable dates are disabled.", { class: "bn-muted", id: prefix + "-date-instructions" });
    const nextAvailable = make("button", "Find next available", { type: "button", class: "bn-secondary" });
    const week = make("div", null, { class: "bn-week", "aria-label": "Dates this week" });
    calendar.append(calendarNav, calendarGrid, calendarLegend, nextAvailable, week);
    const slots = make("fieldset", null, { class: "bn-slots" });
    const waitlistButton = make("button", "Don't see a spot available? Join the waitlist", { type: "button", class: "bn-link-button", hidden: true });
    const waitlistEmail = make("input", null, { type: "email", placeholder: "Email address", "aria-label": "Email for the waitlist", required: true });
    const waitlistSubmit = make("button", "Notify me", { type: "button", class: "bn-secondary" });
    const waitlistForm = make("div", null, { class: "bn-waitlist", hidden: true });
    waitlistForm.append(waitlistEmail, waitlistSubmit);
    // Keep the required waitlist email out of the booking form's validation while it is hidden -
    // a hidden required field is unfocusable and silently blocks the "Add to cart" submit.
    waitlistEmail.disabled = true;
    waitlistButton.addEventListener("click", () => { waitlistButton.hidden = true; waitlistForm.hidden = false; waitlistEmail.disabled = false; waitlistEmail.focus(); });
    waitlistSubmit.addEventListener("click", async () => {
      if (!waitlistEmail.checkValidity() || !chosen || !selectedDate) { waitlistEmail.reportValidity(); return; }
      waitlistSubmit.disabled = true;
      try {
        await request(api + "/waitlist", { method: "POST", body: JSON.stringify({ serviceId: chosen.id, staffId: selected?.staffId, date: selectedDate, email: waitlistEmail.value }) });
        waitlistForm.replaceChildren(make("p", "You're on the waitlist. We'll email you if a spot opens up.", { class: "bn-muted" }));
      } catch (error) { waitlistSubmit.disabled = false; errors.textContent = error.message || "Could not join the waitlist. Please retry."; }
    });
    const answers = make("div", null, { class: "bn-intake" });
    const customer = make("div", null, { class: "bn-customer" });
    const name = make("input", null, { type: "text", autocomplete: "name" });
    const email = make("input", null, { type: "email", autocomplete: "email" });
    const submit = make("button", "Choose a time", { type: "submit", class: "bn-primary", disabled: true });
    const selectedSummary = make("p", "Choose a date and time.", { class: "bn-selection", "aria-live": "polite" });
    const actionBar = make("div", null, { class: "bn-action-bar" });
    let selectedDate = "";
    function field(parent, label, control, suffix) {
      control.id = prefix + "-" + suffix;
      const container = make("div", null, { class: "bn-field" });
      container.append(make("label", label, { for: control.id }), control); parent.append(container);
    }
    field(form, "Event/Service", service, "service"); form.append(details);
    const controls = make("div", null, { class: "bn-controls" });
    field(controls, "Guests", quantity, "quantity"); field(controls, "Timezone", timezone, "timezone");
    controls.append(timeFormat);
    const calendarSlots = make("div", null, { class: "bn-calendar-slots" });
    calendarSlots.append(calendar, slots, waitlistButton, waitlistForm);
    form.append(controls, calendarSlots, answers);
    field(customer, "Your name", name, "name"); field(customer, "Email", email, "email");
    actionBar.append(selectedSummary, submit);
    form.append(customer, actionBar);
    wrapper.append(heading, status, errors, retry, form); root.append(wrapper);
    const money = cents => new Intl.NumberFormat(locale, { style: "currency", currency: catalog.currency }).format(cents / 100);
    const clock = timestamp => new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", hour12: !time24, timeZone: timezone.value || viewerZone }).format(new Date(timestamp));
    // Query the whole product (every variant) so booking shows from any selected variant/colour; the
    // booking still checks out against each service's own linked variant (server-side).
    const resolver = variantResolver(() => request(api + "/catalog?" + new URLSearchParams({ variantIds: productVariants.join(",") })), productVariants);
    const nativeVisibility = new Map(), nativeActions = new Map(), nativeForms = new Set();
    function releaseNativeForm(nativeForm) {
      for (const button of nativeVisibility.keys()) if (nativeForm.contains(button)) setNativeVisibility(button, false, nativeVisibility);
      nativeActions.get(nativeForm)?.remove(); nativeActions.delete(nativeForm); nativeForms.delete(nativeForm);
      if (nativeOwners.get(nativeForm)?.root === root) nativeOwners.delete(nativeForm);
    }
    function restoreNativeControls() {
      for (const nativeForm of [...nativeForms]) releaseNativeForm(nativeForm);
    }
    function syncNativeControls() {
      // Only the primary product form carries the booking button, so a theme with a second
      // (sticky or duplicate) cart form never renders two "Select a booking time" buttons.
      const primaryForm = findProductForm();
      for (const nativeForm of document.querySelectorAll('form[action*="/cart/add"]')) {
        const id = String(nativeForm.querySelector('[name="id"]')?.value || "");
        if (!productVariants.includes(id)) { if (nativeForms.has(nativeForm)) releaseNativeForm(nativeForm); continue; }
        const rule = variantGate(id, productVariants, resolver.status);
        const linked = rule === "book", pending = rule === "resolve";
        if (!linked && !pending) { if (nativeForms.has(nativeForm)) releaseNativeForm(nativeForm); continue; }
        if (!claimNativeForm(nativeForm, root, nativeOwners, releaseNativeForm)) continue;
        nativeForms.add(nativeForm);
        for (const button of nativeForm.querySelectorAll('button[type="submit"], input[type="submit"], [name="add"], .shopify-payment-button, [data-shopify="payment-button"]')) {
          const accelerated = button.matches('.shopify-payment-button, [data-shopify="payment-button"]') || !!button.closest('.shopify-payment-button, [data-shopify="payment-button"]');
          // Accelerated checkout may use an iframe, so hold it until variant linking is verified.
          setNativeVisibility(button, linked || pending && accelerated, nativeVisibility);
        }
        const isPrimary = nativeForm === primaryForm;
        let action = nativeActions.get(nativeForm);
        if (isPrimary && !action) {
          action = make("button", "Select a booking time", { type: "button", class: "bn-native-booking-trigger" });
          action.addEventListener("click", async () => {
            const current = String(nativeForm.querySelector('[name="id"]')?.value || "");
            if (!isHoldActive(checkoutHold) && (currentVariantId !== current || !catalogReady)) await loadCatalog(current).catch(() => {});
            openBooking();
          });
          // Inline properties keep this theme-form control scoped without affecting the merchant theme.
          action.style.cssText = "min-height:44px;width:100%;padding:12px 16px;border:2px solid " + (root.style.getPropertyValue("--bn-accent") || "#253f8e") + ";border-radius:6px;background:" + (root.style.getPropertyValue("--bn-accent") || "#253f8e") + ";color:" + accent.foreground + ";font:inherit;cursor:pointer";
          // Take the buy button's own position in the form rather than appending at the end.
          placeNativeAction(nativeForm, action, nativeForm.querySelector('button[type="submit"], input[type="submit"], [name="add"]'));
          nativeActions.set(nativeForm, action);
        }
        if (action) {
          const show = isPrimary && !pending;
          action.hidden = !show; action.style.setProperty("display", show ? "block" : "none", "important");
        }
      }
      // While the native form carries the booking button, the block's own chrome at its placed position is redundant.
      root.classList.toggle("bn-replacing", nativeReplacementActive(nativeActions.values()));
    }
    function forgetCheckoutHold() {
      checkoutHold = null; checkoutFailed = false; clearTimeout(expiryTimer);
    }
    function rememberCheckoutHold(hold) {
      checkoutHold = hold; checkoutFailed = false; clearTimeout(expiryTimer);
      const delay = Math.max(0, Date.parse(hold.expiresAt) - Date.now()) + 100;
      expiryTimer = setTimeout(async () => {
        forgetCheckoutHold();
        if (!root.isConnected) return;
        await loadCalendar(month);
        errors.textContent = "Your reservation expired. Please choose a time again.";
      }, delay);
      status.textContent = "Your time is reserved until " + clock(hold.expiresAt) + ". Finish checkout to confirm the booking.";
      updateButton(); drawSlots(); drawCalendar();
    }
    function clearError() { errors.textContent = ""; retry.hidden = true; retryAction = null; }
    function failed(error, action) { status.textContent = ""; errors.textContent = error.message || "Unable to load booking options."; retryAction = action; retry.hidden = false; }
    function updateButton() {
      const locked = busy || isHoldActive(checkoutHold);
      submit.disabled = busy || !selected;
      submit.textContent = busy ? "Processing…" : checkoutFailed && isHoldActive(checkoutHold) ? "Retry checkout" : !selected ? "Choose a time" : !chosen.priceCents ? "Confirm booking" : ["FIXED", "PERCENT"].includes(chosen.depositType) ? "Pay deposit" : "Add to cart";
      selectedSummary.textContent = selected ? civilLabel(selectedDate, { month: "short", day: "numeric" }) + " · " + clock(selected.startAt) + " · " + quantity.value + (quantity.value === "1" ? " guest" : " guests") : "Choose a date and time.";
      service.disabled = quantity.disabled = timezone.disabled = locked;
      name.disabled = email.disabled = busy;
      for (const question of questionInputs) question.control.disabled = locked;
      previousMonth.disabled = locked || !month || month <= earliest.slice(0, 7);
      nextMonth.disabled = locked || !month || month >= latest.slice(0, 7);
      nextAvailable.disabled = locked || seeking || !chosen;
    }
    function resetSelection() { selected = null; idempotencyKey = crypto.randomUUID(); slotVersion++; updateButton(); }
    function drawSlots() {
      slots.replaceChildren(make("legend", selectedDate ? "Choose a time · " + civilLabel(selectedDate, { weekday: "short", month: "short", day: "numeric" }) : "Choose a time"));
      for (const slot of visibleSlots) {
        const label = make("label", null, { class: "bn-slot" });
        const radio = make("input", null, { type: "radio", name: prefix + "-slot", required: true });
        radio.checked = !!selected && selected.staffId === slot.staffId && selected.startAt === slot.startAt;
        radio.disabled = busy || isHoldActive(checkoutHold);
        radio.addEventListener("change", () => {
          if (busy || isHoldActive(checkoutHold)) return;
          if (!selected || selected.staffId !== slot.staffId || selected.startAt !== slot.startAt) idempotencyKey = crypto.randomUUID();
          selected = slot; clearError(); updateButton();
        });
        const info = make("span", null, { class: "bn-slot-info" });
        const text = make("span", null, { class: "bn-slot-text" });
        text.append(make("strong", clock(slot.startAt) + " – " + clock(slot.endAt)), make("small", slot.staffName));
        info.append(text, make("span", slot.remaining + "/" + chosen.capacity + " available", { class: "bn-slot-badge" }));
        label.append(radio, info); slots.append(label);
      }
    }
    async function loadSlots() {
      const generation = ++slotVersion;
      selected = null; visibleSlots = []; idempotencyKey = crypto.randomUUID(); updateButton(); drawSlots(); clearError();
      waitlistButton.hidden = true; waitlistForm.hidden = true; waitlistEmail.disabled = true; waitlistSubmit.disabled = false; waitlistEmail.value = "";
      if (!chosen || !selectedDate || !quantity.checkValidity()) return;
      status.textContent = "Finding available times…";
      try {
        const response = await request(api + "/slots?" + new URLSearchParams({ serviceId: chosen.id, date: selectedDate, quantity: quantity.value, timezone: timezone.value }));
        if (generation !== slotVersion) return;
        visibleSlots = response.slots; drawSlots();
        status.textContent = response.slots.length ? "Times shown in " + timezone.value + ". Choose a time to continue." : "No times available on this date. Try Find next available.";
        waitlistButton.hidden = !!response.slots.length;
      } catch (error) { if (generation === slotVersion) failed(error, loadSlots); }
    }
    function focusCalendarDate(date, direction = 1, preferWeek = false) {
      const container = preferWeek && week.querySelector('[data-date="' + date + '"]:not(:disabled)') ? week : calendarGrid;
      const buttons = [...container.querySelectorAll(".bn-day:not(:disabled)")];
      if (!buttons.length) return;
      const target = buttons.find(button => button.dataset.date === date) ||
        (direction < 0 ? [...buttons].reverse().find(button => button.dataset.date <= date) : buttons.find(button => button.dataset.date >= date)) ||
        buttons[direction < 0 ? buttons.length - 1 : 0];
      for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
      target.focus({ preventScroll: true });
    }
    async function navigateCalendar(event, date, preferWeek) {
      const target = calendarKeyDate(date, event.key);
      if (!target) return;
      event.preventDefault();
      if (busy || isHoldActive(checkoutHold) || target < earliest || target > latest) return;
      const direction = target < date ? -1 : 1;
      if (!target.startsWith(month)) await loadCalendar(target.slice(0, 7), false, target, direction);
      else focusCalendarDate(target, direction, preferWeek);
    }
    function chooseDate(date) {
      if (busy || isHoldActive(checkoutHold) || !availableDays.get(date)) return;
      selectedDate = date; drawCalendar(); void loadSlots();
    }
    function dayButton(date, compact) {
      const enabled = availableDays.get(date) && date >= earliest && date <= latest;
      const button = make("button", compact ? civilLabel(date, { weekday: "short" }) + " " + Number(date.slice(8)) : String(Number(date.slice(8))), {
        type: "button", class: "bn-day", "aria-label": civilLabel(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) + (enabled ? ", available" : ", unavailable"),
        "aria-pressed": selectedDate === date, "data-date": date
      });
      button.disabled = !enabled || busy || isHoldActive(checkoutHold);
      if (date === earliest) button.setAttribute("data-today", "true");
      button.addEventListener("click", () => chooseDate(date));
      button.addEventListener("keydown", event => void navigateCalendar(event, date, compact));
      const firstAvailable = [...availableDays].find(([day, open]) => open && day >= earliest && day <= latest)?.[0];
      button.tabIndex = enabled && (date === selectedDate || !availableDays.get(selectedDate) && date === firstAvailable) ? 0 : -1;
      return button;
    }
    function drawCalendar() {
      if (!month) return;
      const active = document.activeElement, focusInWeek = week.contains(active), focusInCalendar = calendarGrid.contains(active) || focusInWeek;
      const focusedDate = focusInCalendar ? active?.dataset.date : null;
      monthHeading.textContent = civilLabel(month + "-01", { month: "long", year: "numeric" });
      calendarGrid.replaceChildren();
      for (const day of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) calendarGrid.append(make("span", day, { class: "bn-weekday", "aria-hidden": "true" }));
      for (let index = 0; index < weekday(month + "-01"); index++) calendarGrid.append(make("span", "", { "aria-hidden": "true" }));
      for (const date of monthDates(month)) calendarGrid.append(dayButton(date, false));
      week.replaceChildren();
      const anchor = selectedDate && selectedDate.startsWith(month) ? selectedDate : month + "-01";
      const first = shiftDay(anchor, -weekday(anchor));
      for (let index = 0; index < 7; index++) week.append(dayButton(shiftDay(first, index), true));
      updateButton();
      if (focusedDate && !busy) focusCalendarDate(focusedDate, 1, focusInWeek);
    }
    async function fetchCalendar(targetMonth) {
      return request(api + "/calendar?" + new URLSearchParams({ serviceId: chosen.id, month: targetMonth, quantity: quantity.value, timezone: timezone.value }));
    }
    function applyCalendar(response, targetMonth) {
      month = targetMonth; earliest = response.today; latest = response.lastDate;
      availableDays = new Map(response.days.map(day => [day.date, day.available]));
      drawCalendar();
    }
    async function loadCalendar(targetMonth = month, selectFirst = false, focusDate, focusDirection = 1) {
      const generation = ++calendarVersion;
      resetSelection(); visibleSlots = []; drawSlots(); clearError();
      if (!chosen || !quantity.checkValidity()) return;
      status.textContent = "Loading available dates…";
      availableDays = new Map(); month = targetMonth; drawCalendar();
      try {
        const response = await fetchCalendar(targetMonth);
        if (generation !== calendarVersion) return;
        applyCalendar(response, targetMonth);
        if (selectFirst || !availableDays.get(selectedDate)) selectedDate = response.days.find(day => day.available)?.date || "";
        drawCalendar();
        if (focusDate) focusCalendarDate(focusDate, focusDirection);
        if (selectedDate && availableDays.get(selectedDate)) await loadSlots();
        else status.textContent = "No available dates this month. Try Find next available.";
      } catch (error) { if (generation === calendarVersion) failed(error, () => loadCalendar(targetMonth, selectFirst)); }
    }
    async function findNextAvailable() {
      if (seeking || busy || isHoldActive(checkoutHold) || !chosen) return;
      seeking = true; const generation = ++calendarVersion; resetSelection(); clearError(); updateButton();
      const after = selectedDate || earliest;
      let candidate = after.slice(0, 7);
      status.textContent = "Finding the next available date…";
      try {
        while (candidate <= latest.slice(0, 7)) {
          const response = await fetchCalendar(candidate);
          if (generation !== calendarVersion) return;
          const day = response.days.find(item => item.available && item.date >= after);
          if (day) { applyCalendar(response, candidate); selectedDate = day.date; drawCalendar(); await loadSlots(); return; }
          candidate = shiftMonth(candidate, 1);
        }
        status.textContent = "No dates are available in the booking window. Please contact the store.";
      } catch (error) { if (generation === calendarVersion) failed(error, findNextAvailable); }
      finally { seeking = false; updateButton(); }
    }
    function setTimezones() {
      const current = timezone.value || viewerZone;
      let zones = [viewerZone, chosen.timezone || chosen.location?.timezone, "UTC"].filter(Boolean);
      if (typeof Intl.supportedValuesOf === "function") zones = zones.concat(Intl.supportedValuesOf("timeZone"));
      timezone.replaceChildren();
      for (const zone of [...new Set(zones)]) timezone.append(make("option", zone === viewerZone ? zone + " (your timezone)" : zone, { value: zone }));
      timezone.value = current;
    }
    function chooseService() {
      chosen = catalog.services.find(item => item.id === service.value);
      if (!chosen) return;
      calendarVersion++; slotVersion++; selected = null; selectedDate = ""; clearError();
      heading.textContent = chosen.title; earliest = chosen.today; latest = chosen.lastDate; month = todayInZone(timezone.value || viewerZone).slice(0, 7);
      quantity.max = chosen.capacity; quantity.value = "1"; setTimezones();
      details.textContent = chosen.durationMin + " minutes · " + (chosen.priceCents ? money(chosen.priceCents) + " per guest" : "Free");
      if (["FIXED", "PERCENT"].includes(chosen.depositType)) details.textContent += " · Pay " + money(chosen.dueCents) + " deposit per guest; balance payable to the store.";
      customer.hidden = chosen.priceCents > 0; name.required = email.required = chosen.priceCents === 0;
      answers.replaceChildren(); questionInputs = [];
      for (const question of chosen.questions || []) {
        const options = question.options || [];
        const control = make(options.length ? "select" : question.type === "TEXTAREA" ? "textarea" : "input");
        if (options.length) {
          control.append(make("option", "Choose…", { value: "" }));
          for (const option of options) control.append(make("option", option, { value: option }));
        }
        control.required = question.required;
        field(answers, question.label + (question.required ? " *" : ""), control, question.id);
        questionInputs.push({ id: question.id, control });
      }
      form.hidden = false;
      void loadCalendar(month, true);
    }
    function renderShowcase() {
      if (surface === "booking") return;
      showcase.replaceChildren();
      const services = surface === "featured" ? catalog.services.slice(0, 1) : catalog.services;
      for (const item of services) {
        const card = make("article", null, { class: "bn-service-card" });
        if (item.imageUrl && /^https:\/\//.test(item.imageUrl)) card.append(make("img", null, { src: item.imageUrl, alt: "", loading: "lazy", class: "bn-service-image" }));
        card.append(make("h3", item.title), make("p", item.durationMin + " minutes · " + (item.priceCents ? money(item.priceCents) + " per guest" : "Free")));
        if (item.locationName || item.location?.name) card.append(make("p", item.locationName || item.location.name, { class: "bn-muted" }));
        const button = make("button", root.dataset.buttonLabel || "Book a time", { type: "button", class: "bn-primary" });
        button.addEventListener("click", () => { service.value = item.id; chooseService(); openBooking(); });
        card.append(button); showcase.append(card);
      }
    }
    function findProductForm() {
      const section = root.closest(".shopify-section") || document;
      const candidates = [...section.querySelectorAll('form[action*="/cart/add"]')];
      return candidates.find(candidate => productVariants.includes(String(candidate.querySelector('[name="id"]')?.value || ""))) ||
        [...document.querySelectorAll('form[action*="/cart/add"]')].find(candidate => productVariants.includes(String(candidate.querySelector('[name="id"]')?.value || "")));
    }
    function currentVariant() {
      return activeVariant({
        formVariant: findProductForm()?.querySelector('[name="id"]')?.value,
        urlVariant: new URL(window.location.href).searchParams.get("variant"),
        fallback: root.dataset.variantId, productVariants
      });
    }
    async function loadCatalog(variant = currentVariant()) {
      const generation = ++catalogVersion; currentVariantId = variant; catalogReady = false; calendarVersion++; slotVersion++; chosen = null; resetSelection();
      form.hidden = true; clearError(); status.textContent = "Loading booking options…"; syncNativeControls();
      if (popup && !wrapper.open) { root.insertBefore(status, wrapper); root.insertBefore(errors, wrapper); root.insertBefore(retry, wrapper); }
      try {
        let data;
        if (productVariants.length) data = await resolver.load(variant || productVariants[0]);
        else {
          const query = new URLSearchParams();
          if (root.dataset.serviceId) query.set("serviceId", root.dataset.serviceId);
          data = await request(api + "/catalog?" + query);
        }
        if (generation !== catalogVersion) return data;
        catalog = data; currentVariantId = variant; catalogReady = true; syncNativeControls();
        service.replaceChildren();
        for (const option of data.services) service.append(make("option", option.title, { value: option.id }));
        if (!data.services.length) {
          form.hidden = true; trigger.hidden = true; showcase.replaceChildren();
          // Shoppers on an unlinked product should see nothing; only the theme editor explains the empty block.
          status.textContent = window.Shopify && window.Shopify.designMode ? "No booking options are available for this product." : "";
          return data;
        }
        heading.after(status, errors, retry);
        // Default to the service linked to the selected variant, if any, otherwise the first service.
        const preferred = data.services.find(item => item.variantId && String(item.variantId).split("/").pop() === currentVariantId);
        if (preferred) service.value = preferred.id;
        trigger.hidden = false; renderShowcase(); chooseService(); return data;
      } catch (error) {
        if (generation === catalogVersion) failed(error, () => loadCatalog(currentVariant()));
        throw error;
      }
    }
    function variantChanged() {
      if (!root.isConnected || !productVariants.length || busy || isHoldActive(checkoutHold)) return;
      const variant = currentVariant();
      if (variant !== currentVariantId) void loadCatalog(variant).catch(() => {});
    }
    const bypass = new WeakSet();
    async function interceptNative(event, target, nativeForm, resume) {
      if (bypass.has(target)) { bypass.delete(target); return; }
      const id = String(nativeForm.querySelector('[name="id"]')?.value || "");
      const rule = variantGate(id, productVariants, resolver.status);
      if (rule === "pass") return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (busy) return;
      if (isHoldActive(checkoutHold)) { openBooking(); status.textContent = "Finish your saved checkout before choosing a different booking."; return; }
      try {
        const data = await resolver.load(id); syncNativeControls();
        const latestId = String(nativeForm.querySelector('[name="id"]')?.value || "");
        if (latestId !== id) { variantChanged(); return; }
        if (!data.services.length) { bypass.add(target); resume(); return; }
        if (currentVariantId !== id || !catalogReady) await loadCatalog(id);
        openBooking(); status.textContent = "Choose a booking date and time before adding this service.";
      } catch { openBooking(); failed(new Error("Booking options could not be verified. Please retry before adding this product."), () => loadCatalog(id)); }
    }
    if (productVariants.length) {
      document.addEventListener("submit", event => {
        if (!root.isConnected || !(event.target instanceof HTMLFormElement) || !event.target.action.includes("/cart/add")) return;
        const nativeForm = event.target;
        void interceptNative(event, nativeForm, nativeForm, () => nativeForm.requestSubmit(event.submitter || undefined));
      }, true);
      document.addEventListener("click", event => {
        if (!root.isConnected || !(event.target instanceof Element)) return;
        const button = event.target.closest('button[type="submit"], input[type="submit"], .shopify-payment-button, [name="add"], [data-shopify="payment-button"]');
        const nativeForm = button?.closest('form[action*="/cart/add"]');
        if (!button || !nativeForm) return;
        void interceptNative(event, button, nativeForm, () => button.click());
      }, true);
      document.addEventListener("change", event => {
        if (event.target instanceof Element && !root.contains(event.target) && event.target.closest('form[action*="/cart/add"], variant-selects, variant-radios, [data-variant-picker]')) queueMicrotask(variantChanged);
      });
      for (const name of ["variant:change", "variant-change", "variantChanged", "product:variant-change"]) document.addEventListener(name, () => queueMicrotask(variantChanged));
      window.addEventListener("popstate", variantChanged);
      // Themes often update a hidden variant input without dispatching a change event.
      const observer = new MutationObserver(() => { if (root.isConnected) syncNativeControls(); });
      observer.observe(document.body, { childList: true, subtree: true });
      const monitor = setInterval(() => { if (!root.isConnected) { clearInterval(monitor); observer.disconnect(); restoreNativeControls(); clearTimeout(expiryTimer); } else if (!document.hidden) { syncNativeControls(); variantChanged(); } }, 750);
    }
    service.addEventListener("change", chooseService);
    quantity.addEventListener("change", () => { if (!busy) void loadCalendar(month); });
    timezone.addEventListener("change", () => { if (!busy) { selectedDate = ""; month = todayInZone(timezone.value).slice(0, 7); void loadCalendar(month, true); } });
    previousMonth.addEventListener("click", () => { if (!busy) void loadCalendar(shiftMonth(month, -1), true); });
    nextMonth.addEventListener("click", () => { if (!busy) void loadCalendar(shiftMonth(month, 1), true); });
    nextAvailable.addEventListener("click", () => void findNextAvailable());
    timeFormat.addEventListener("click", () => {
      time24 = !time24; timeFormat.textContent = time24 ? "24-hour" : "AM/PM"; timeFormat.setAttribute("aria-pressed", String(time24));
      try { localStorage.setItem("booknest:24h", String(time24)); } catch {}
      drawSlots(); updateButton();
    });
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (busy || !selected || !chosen || !form.reportValidity()) return;
      if (!isHoldActive(checkoutHold) && productVariants.length && currentVariant() !== currentVariantId) {
        await loadCatalog(currentVariant()).catch(() => {});
        errors.textContent = "The product option changed. Please choose a time for the current service.";
        return;
      }
      busy = true; updateButton(); drawSlots(); drawCalendar(); clearError();
      const input = { serviceId: chosen.id, staffId: selected.staffId, startAt: selected.startAt, quantity: Number(quantity.value), idempotencyKey };
      const intake = questionInputs.map(item => ({ questionId: item.id, value: item.control.value }));
      try {
        if (!chosen.priceCents) {
          await request(api + "/bookings", { method: "POST", body: JSON.stringify({ booking: input, customer: { name: name.value, email: email.value, answers: intake } }) });
          form.hidden = true; status.textContent = "Booking confirmed. Your confirmation will be sent to " + email.value + ".";
        } else {
          const hold = await request(api + "/holds", { method: "POST", body: JSON.stringify({ ...input, answers: intake }) });
          rememberCheckoutHold(hold);
          if (hold.checkoutUrl) { window.location.assign(hold.checkoutUrl); return; }
          const cart = await request(localRoot + "cart.js");
          const existing = cart.items.find(item => item.properties && item.properties["_BookNest Reservation"] === hold.reservationId);
          if (existing && existing.quantity !== hold.item.quantity) await request(localRoot + "cart/change.js", { method: "POST", body: JSON.stringify({ id: existing.key, quantity: hold.item.quantity }) });
          if (!existing) await request(localRoot + "cart/add.js", { method: "POST", body: JSON.stringify({ items: [hold.item], sections: "cart-items,cart-icon-bubble,cart-drawer,cart-live-region-text,cart-footer" }) });
          window.location.assign(localRoot + "cart");
        }
      } catch (error) {
        checkoutFailed = isHoldActive(checkoutHold);
        errors.textContent = error.message || "Unable to complete the booking. Please try again.";
        if (error.status === 409) { forgetCheckoutHold(); void loadCalendar(month); }
      } finally { busy = false; updateButton(); drawSlots(); drawCalendar(); }
    });
    void loadCatalog(currentVariant()).catch(() => {});
  }
  function boot() { document.querySelectorAll("[data-booknest]").forEach(initialize); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  document.addEventListener("shopify:section:load", boot);
})();
