import { z } from 'zod';
export const loginSchema = z.object({
  email: z.email().max(254).trim().toLowerCase(),
  password: z.string().min(1).max(128),
}).strict();
export const registerSchema = loginSchema.extend({
  name: z.string().trim().min(2).max(80),
  password: z.string().min(12).max(128),
});
export const publicUserSchema = z.object({ id: z.string(), name: z.string(), email: z.email() });
export type PublicUser = z.infer<typeof publicUserSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
