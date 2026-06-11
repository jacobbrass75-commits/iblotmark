import { users, type User } from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { getTierLimits } from "./authTiers";

/** Strip password from user object before returning to clients */
export function sanitizeUser(user: User): Omit<User, "password"> {
  const { password, ...rest } = user;
  return rest;
}

/**
 * Get or create a local user record for a Clerk user.
 * The local record tracks usage (tokens, storage) and tier.
 */
export async function getOrCreateUser(
  clerkUserId: string,
  email: string,
  tier: string,
): Promise<User> {
  const limits = getTierLimits(tier);
  const existing = await getUserById(clerkUserId);
  if (existing) {
    // Sync tier and plan limits from Clerk if they changed.
    if (
      existing.tier !== limits.tier
        || existing.tokenLimit !== limits.tokenLimit
        || existing.storageLimit !== limits.storageLimit
    ) {
      return await updateUser(clerkUserId, {
        tier: limits.tier,
        tokenLimit: limits.tokenLimit,
        storageLimit: limits.storageLimit,
      } as Partial<User>);
    }
    return existing;
  }

  // Create new local record
  const now = new Date();
  const [created] = await db
    .insert(users)
    .values({
      id: clerkUserId,
      email,
      username: email, // default username to email
      password: "", // not used with Clerk
      tier: limits.tier,
      tokensUsed: 0,
      tokenLimit: limits.tokenLimit,
      storageUsed: 0,
      storageLimit: limits.storageLimit,
      emailVerified: true, // Clerk handles verification
      billingCycleStart: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    .returning();
  return created;
}

export async function getUserById(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user || null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user || null;
}

export async function updateUser(id: string, data: Partial<User>): Promise<User> {
  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() } as any)
    .where(eq(users.id, id))
    .returning();
  return updated;
}

export async function incrementTokenUsage(id: string, tokens: number): Promise<void> {
  const user = await getUserById(id);
  if (!user) throw new Error("User not found");
  await db
    .update(users)
    .set({ tokensUsed: user.tokensUsed + tokens, updatedAt: new Date() } as any)
    .where(eq(users.id, id));
}

export async function resetTokenUsage(id: string): Promise<void> {
  await db
    .update(users)
    .set({ tokensUsed: 0, billingCycleStart: new Date(), updatedAt: new Date() } as any)
    .where(eq(users.id, id));
}
