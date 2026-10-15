# Additional hours and customer change policies

Date: 2026-10-15

Additional hours are explicit date-specific opening windows. A window belongs to one store and location and can target one assigned Availability or all active assigned Availabilities at that location. The original evidence exposed special hours but did not establish full override semantics; this implementation is additive.

Store start/end timestamps in UTC with the chosen IANA scheduling timezone. The pure engine merges weekly and additional coverage, preserves rule anchors for configurable slot intervals, and deduplicates slots. Service hour restrictions, closures, approved time off, calendar conflicts, buffers, notice windows and capacity remain authoritative. Merchant creation/removal checks store ownership and assignments and serializes on Availability locks. Removal is refused while overlapping checkout holds exist.

Customer cancellation and rescheduling have separate nonnegative hour cutoffs; zero preserves access until the appointment starts. Compare UTC instants, including DST transitions. The customer portal hides unavailable actions and checks POST requests; booking mutations reread the appointment and policy and evaluate the current clock after acquiring the booking lock. Merchant cancellation remains available independently.

The generated migration includes these fields, the additional-hours table and database time-order/quantity invariants. It has not been applied to a live database. Browser and live database acceptance remain open.
