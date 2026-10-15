import { describe, expect, it } from "vitest";
import fixture from "../fixtures/booking-popup-dom.json";
import { findAvailableSlotRows, hasSlotSelectionChanged, getSuccessfulCartCapture, findBookingCartButton } from "../../scripts/recon/booking-dom.mjs";

describe("booking capture regression", () => {
  it("targets the six actual slot rows from the failed capture", () => {
    const rows = findAvailableSlotRows(fixture);
    expect(rows.map((row) => row.backendNodeId)).toEqual([1652, 1657, 1662, 1667, 1672, 1677]);
    expect(rows.every((row) => row.nodeName === "DIV")).toBe(true);
  });

  it("ignores scripts, styles, and text outside the slot container", () => {
    const root = { nodeName: "HTML", children: [
      { nodeName: "SCRIPT", children: [{ nodeName: "#text", nodeType: 3, nodeValue: "5 / 5 available" }] },
      { nodeName: "STYLE", children: [{ nodeName: "#text", nodeType: 3, nodeValue: "available" }] },
      { nodeName: "DIV", children: [{ nodeName: "#text", nodeType: 3, nodeValue: "5 / 5 available" }] },
    ] };
    expect(findAvailableSlotRows(root)).toEqual([]);
  });

  it("rejects sold-out and disabled rows", () => {
    const root = structuredClone(fixture);
    const container = root.children[0]!;
    container.children[0]!.children[1]!.children[0]!.nodeValue = "0 / 5 available";
    container.children[1]!.attributes.push("aria-disabled", "true");
    expect(findAvailableSlotRows(root)).toHaveLength(4);
  });

  it("does not count an unchanged slot as a successful selection", () => {
    const row = findAvailableSlotRows(fixture)[0]!;
    expect(hasSlotSelectionChanged(row, fixture)).toBe(false);
  });

  it("recognizes a selection render change for the same time row", () => {
    const root = structuredClone(fixture);
    const row = findAvailableSlotRows(fixture)[0]!;
    root.children[0]!.children[0]!.attributes.push("aria-selected", "true");
    expect(hasSlotSelectionChanged(row, root)).toBe(true);
  });


  it("does not confuse the floating Book Now button with cart confirmation", () => {
    expect(findBookingCartButton({ nodeName: "BODY", children: [
      { nodeName: "BUTTON", children: [{ nodeName: "#text", nodeType: 3, nodeValue: "Book Now" }] },
      fixture,
    ] })).toBeNull();
  });

  it("recognizes the selected-time cart button by its widget marker", () => {
    const button = { nodeName: "BUTTON", backendNodeId: 9999,
      attributes: ["data-servicify", "servicify-add-to-cart-button"],
      children: [{ nodeName: "#text", nodeType: 3, nodeValue: "Add to Cart" }] };
    const root = { ...fixture, children: [...fixture.children, button] };
    expect(findBookingCartButton(root)).toBe(button);
    expect(findBookingCartButton({ ...root, children: [...fixture.children, { ...button, attributes: [...button.attributes, "disabled", ""] }] })).toBeNull();
  });

  it("can traverse shadow roots without assuming the calendar uses one", () => {
    expect(findAvailableSlotRows({ nodeName: "DIV", shadowRoots: [fixture] })).toHaveLength(6);
  });

  it("rejects telemetry and non-successful cart requests as completion", () => {
    expect(getSuccessfulCartCapture([
      { method: "POST", url: "https://servicify-appointments.herokuapp.com/atc/log", status: 200, postData: "{}" },
      { method: "POST", url: "https://yogababble.myshopify.com/cart/add.js", status: 422, postData: "{}" },
    ])).toBeNull();
  });

  it("requires request metadata and a real cart response before completion", () => {
    const request = {
      method: "POST", url: "https://yogababble.myshopify.com/cart/add.js", status: 200,
      postData: JSON.stringify({ items: [{ id: 123, quantity: 1, properties: { Date: "2026-10-14" } }] }),
      responseBody: JSON.stringify({ items: [{ id: 123, quantity: 1, properties: { Date: "2026-10-14" } }] }),
    };
    expect(getSuccessfulCartCapture([request])).toEqual(request);
    expect(getSuccessfulCartCapture([{ ...request, status: undefined }])).toBeNull();
    expect(getSuccessfulCartCapture([{ ...request, responseBody: null }])).toBeNull();
    expect(getSuccessfulCartCapture([{ ...request, postData: "{}" }])).toBeNull();
  });
});
