import { homeServices } from "./home-services.js";
import type { IndustryProfile } from "./types.js";

// STUB: replace this whole file with a complete, hand-written profile.
export const autoRepair: IndustryProfile = {
  ...homeServices,
  id: "auto-repair",
  name: "Auto repair shop",
};
