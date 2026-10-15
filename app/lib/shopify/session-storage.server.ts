import type { Session as SessionRow } from "@prisma/client";
import { Session } from "@shopify/shopify-app-react-router/server";

type SessionTable = {
  upsert(args: { where: { id: string }; create: SessionRow; update: SessionRow }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<SessionRow | null>;
  deleteMany(args: { where: { id: { in: string[] } } }): Promise<unknown>;
  findMany(args: { where: { shop: string } }): Promise<SessionRow[]>;
};

/** Uses the app package's own Session class so SDK versions cannot diverge. */
export class ShopifySessionStorage {
  constructor(private readonly table: SessionTable) {}

  async storeSession(session: Session): Promise<boolean> {
    const user = session.onlineAccessInfo?.associated_user;
    const row: SessionRow = {
      id: session.id, shop: session.shop, state: session.state, isOnline: session.isOnline,
      scope: session.scope ?? null, expires: session.expires ?? null, accessToken: session.accessToken ?? "",
      refreshToken: session.refreshToken ?? null, refreshTokenExpires: session.refreshTokenExpires ?? null,
      userId: user?.id === undefined ? null : BigInt(user.id),
      firstName: user?.first_name ?? null, lastName: user?.last_name ?? null,
      email: user?.email ?? null, locale: user?.locale ?? null,
      accountOwner: user?.account_owner ?? false,
      collaborator: user?.collaborator ?? false, emailVerified: user?.email_verified ?? false,
    };
    await this.table.upsert({ where: { id: session.id }, create: row, update: row });
    return true;
  }

  private restore(row: SessionRow): Session {
    const values: Record<string, string | number | boolean> = {
      id: row.id, shop: row.shop, state: row.state, isOnline: row.isOnline,
      accessToken: row.accessToken,
    };
    if (row.scope !== null) values.scope = row.scope;
    if (row.expires) values.expires = row.expires.getTime();
    if (row.refreshToken) values.refreshToken = row.refreshToken;
    if (row.refreshTokenExpires) values.refreshTokenExpires = row.refreshTokenExpires.getTime();
    if (row.userId !== null) {
      values.userId = row.userId.toString();
      if (row.firstName !== null) values.firstName = row.firstName;
      if (row.lastName !== null) values.lastName = row.lastName;
      if (row.email !== null) values.email = row.email;
      if (row.locale !== null) values.locale = row.locale;
      values.accountOwner = row.accountOwner;
      values.collaborator = row.collaborator ?? false;
      values.emailVerified = row.emailVerified ?? false;
    }
    return Session.fromPropertyArray(Object.entries(values), true);
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const row = await this.table.findUnique({ where: { id } });
    return row ? this.restore(row) : undefined;
  }
  async deleteSession(id: string): Promise<boolean> { return this.deleteSessions([id]); }
  async deleteSessions(ids: string[]): Promise<boolean> {
    await this.table.deleteMany({ where: { id: { in: ids } } });
    return true;
  }
  async findSessionsByShop(shop: string): Promise<Session[]> {
    return (await this.table.findMany({ where: { shop } })).map((row) => this.restore(row));
  }
}
