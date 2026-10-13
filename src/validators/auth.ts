import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));

export const signUpInput = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email,
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

export const signInInput = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});

export type SignUpInput = z.infer<typeof signUpInput>;
export type SignInInput = z.infer<typeof signInInput>;
