export const meta = () => [{ title: "BookNest — Merchant Terms & Data Processing Agreement" }];

export default function Terms() {
  return (
    <main className="bn-login" style={{ alignItems: "flex-start", padding: "48px 16px" }}>
      <section className="bn-login-card" style={{ maxWidth: 720, textAlign: "left" }}>
        <p className="bn-eyebrow">BookNest</p>
        <h1>Merchant Terms &amp; Data Processing Agreement</h1>
        <p><em>Last updated: 15 October 2026</em></p>

        <p>
          This agreement applies between BookNest ("we", "us") and a merchant installing
          BookNest on their Shopify store ("you"). It covers how we process your customers'
          personal data on your behalf while providing the app. For how we handle that data,
          see our <a href="/privacy">Privacy Policy</a>.
        </p>

        <h2>1. What BookNest does</h2>
        <p>
          BookNest is a Shopify app that adds appointment-booking functionality to your store.
          To do this, we process personal data of your customers (name, email, phone) that they
          submit when booking an appointment through your storefront.
        </p>

        <h2>2. Roles</h2>
        <p>
          For this data, you are the data controller and BookNest acts as a data processor,
          processing personal data only as needed to operate the booking functionality you've
          configured, and only on your instructions as expressed through your use of the app.
        </p>

        <h2>3. Our commitments to you</h2>
        <ul>
          <li>We process your customers' data only to provide BookNest's booking functionality — never for our own marketing or for sale to third parties.</li>
          <li>We limit the data we collect to what's needed: name, email, and phone. We don't collect billing or shipping addresses.</li>
          <li>We automatically process Shopify's standard customer data request, customer redaction, and shop redaction webhooks.</li>
          <li>We anonymize a customer's personal data 24 months after their appointment date (see <a href="/privacy">Privacy Policy</a>).</li>
          <li>We log administrative access to records containing personal data.</li>
          <li>If we become aware of a security incident affecting your customers' data, we will notify you within 72 hours, per our <a href="https://github.com/ankursingh4u/booknest/blob/master/docs/security-incident-response.md">incident response policy</a>.</li>
        </ul>

        <h2>4. Subprocessors</h2>
        <p>We use the following subprocessors strictly to operate BookNest:</p>
        <ul>
          <li><strong>Resend</strong> — transactional email delivery</li>
          <li><strong>Google</strong> — only if you connect Google Calendar</li>
          <li><strong>Anthropic</strong> — only if you enable AI insight summaries; receives aggregate counts only, never individual customer records</li>
        </ul>

        <h2>5. Your responsibilities</h2>
        <p>
          You're responsible for having a lawful basis to collect your customers' booking
          information and for your own store's privacy disclosures to your customers.
        </p>

        <h2>6. On uninstall</h2>
        <p>
          When you uninstall BookNest, we stop processing new data immediately. Per Shopify's
          standard shop redaction process, your store's data is fully deleted from our systems.
        </p>

        <h2>7. Contact</h2>
        <p>
          Questions about this agreement: <a href="mailto:admin@swiftcart.live">admin@swiftcart.live</a>.
        </p>
      </section>
    </main>
  );
}
