import { teamHeaders } from "../lib/team/session.server";
export const headers = () => teamHeaders;
export default function TeamLogin() {
  return <main className="bn-login"><section className="bn-login-card"><h1>BookNest Team Portal</h1><p>Ask your store manager for a new invitation link to sign in. Each link can be used once.</p></section></main>;
}
