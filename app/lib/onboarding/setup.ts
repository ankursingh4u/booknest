export type SetupProgress = { email: string | null; services: number };
export type SetupStep = { title: string; done: boolean; text: string; url: string };

// BookNest auto-creates a default location, a default Availability, and Mon–Fri 9–5 hours on
// first use, so the only setup actions that need a human decision are confirming store
// preferences and creating the first Event/Service. Everything else is editable later.
export function setupSteps(progress: SetupProgress): SetupStep[] {
  return [
    { title: "Confirm store preferences", done: Boolean(progress.email), text: "Check your timezone and reply email.", url: "/app/settings" },
    { title: "Create your first Event/Service", done: progress.services > 0,
      text: "Set duration, capacity, and price, and choose who can be booked. We start you with a location and an Availability (Mon–Fri, 9–5) you can adjust anytime.", url: "/app/manage/services" },
  ];
}

export function setupError(progress: SetupProgress & { tested: boolean }): string | null {
  if (!progress.email || progress.services < 1) return "Add your reply email and create an Event/Service first.";
  if (!progress.tested) return "Test a storefront booking before marking setup complete.";
  return null;
}
