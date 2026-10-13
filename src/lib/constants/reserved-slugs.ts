// Slugs that would collide with app routes (/b/[slug] is namespaced, but we keep these
// reserved anyway so a shop can never impersonate a platform page or a future vanity URL).
export const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "b", "billing", "book", "dashboard", "login", "logout",
  "onboarding", "openchair", "payouts", "pricing", "settings", "signup", "support", "www",
]);
