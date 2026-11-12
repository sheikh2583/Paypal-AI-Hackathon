/** Client sign-ins (D77) are users too, so only the owner's email, or non-client users, count as the owner. */
export function countOwnerUsers(client: { prepare(sql: string): { get(...params: unknown[]): unknown } }, ownerEmail: string | undefined): number {
  const row = (ownerEmail
    ? client.prepare('SELECT COUNT(*) AS count FROM "user" WHERE lower(email) = ?').get(ownerEmail)
    : client.prepare('SELECT COUNT(*) AS count FROM "user" WHERE lower(email) NOT IN (SELECT email FROM client_accounts)').get()) as { count: number };
  return row.count;
}
