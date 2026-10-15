export const meta = () => [{ title: "BookNest — Privacy Policy" }];

export default function Privacy() {
  return (
    <main className="bn-login" style={{ alignItems: "flex-start", padding: "48px 16px" }}>
      <section className="bn-login-card" style={{ maxWidth: 720, textAlign: "left" }}>
        <p className="bn-eyebrow">BookNest</p>
        <h1>Privacy Policy</h1>
        <p><em>Last updated: 15 October 2026</em></p>

        <p>
          BookNest ("we", "us") provides appointment-booking functionality for merchants running
          Shopify stores ("merchants"). This policy explains what personal data BookNest processes
          about merchants' customers and store visitors ("customers"), and why.
        </p>

        <h2>Who we are</h2>
        <p>
          BookNest is operated as a Shopify app. For any privacy question, data request, or
          concern, contact <a href="mailto:admin@swiftcart.live">admin@swiftcart.live</a>.
        </p>

        <h2>What we collect</h2>
        <p>When a customer books an appointment through a merchant's store, BookNest collects:</p>
        <ul>
          <li>Name</li>
          <li>Email address</li>
          <li>Phone number (if provided)</li>
        </ul>
        <p>
          BookNest does not collect or store billing or shipping addresses. We also receive the
          merchant's store domain and a Shopify access token when a merchant installs the app, and
          order/booking details (service, time, price) needed to operate the booking itself.
        </p>

        <h2>Why we collect it</h2>
        <p>This data is used only to:</p>
        <ul>
          <li>Create, display, and manage the booking inside the merchant's admin</li>
          <li>Send booking confirmation, reminder, reschedule, and cancellation emails</li>
          <li>Let the merchant optionally sync the booking to their own Google Calendar</li>
        </ul>
        <p>
          We do not use this data for advertising, and we do not sell it to anyone.
        </p>

        <h2>Who we share it with</h2>
        <p>BookNest uses the following service providers strictly to operate the app on the merchant's behalf:</p>
        <ul>
          <li><strong>Resend</strong> — delivers transactional emails (confirmations, reminders, cancellations)</li>
          <li><strong>Google</strong> — only if a merchant connects their Google Calendar; used to check availability and create calendar events</li>
          <li><strong>Anthropic</strong> — only if a merchant enables AI-generated insight summaries; receives aggregate booking counts and totals only, never individual customer records</li>
          <li><strong>Shopify</strong> — the platform BookNest is built on</li>
        </ul>

        <h2>How long we keep it</h2>
        <p>
          We retain a customer's name, email, and phone number for 24 months after their appointment
          date, after which this information is automatically anonymized. Aggregate, non-identifying
          booking counts may be kept longer for reporting. A merchant or customer can request earlier
          deletion at any time (see below).
        </p>

        <h2>Your rights</h2>
        <p>
          Customers can request a copy of their data or its deletion at any time by contacting the
          merchant they booked with, or by emailing <a href="mailto:admin@swiftcart.live">admin@swiftcart.live</a>.
          BookNest automatically processes Shopify's standard data request, customer redaction, and
          shop redaction requests.
        </p>

        <h2>Security</h2>
        <p>
          All traffic to BookNest is encrypted in transit (HTTPS). Every customer's data is scoped
          to their own store and is never visible to other merchants. Calendar connection tokens are
          encrypted before storage.
        </p>

        <h2>Changes to this policy</h2>
        <p>
          If this policy changes, we will update the date at the top of this page.
        </p>
      </section>
    </main>
  );
}
