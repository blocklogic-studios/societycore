import { system, world } from "@minecraft/server";
import { SocietyManager } from "./core/SocietyManager.js";
import { setupUIHandlers } from "./ui/handlers.js";

export const society = new SocietyManager();

const COMPONENTS = [
  "societycore:civic_hub",
  "societycore:court_bench",
  "societycore:tax_office",
  "societycore:job_board",
  "societycore:school_desk",
  "societycore:permit_desk",
  "societycore:waste_bin",
  "societycore:survey_stake",
  "societycore:hotel_desk",
  "societycore:dispatch_console",
  "societycore:customs_desk",
  "societycore:notary_desk"
];

system.beforeEvents.startup.subscribe((event) => {
  const reg = event.blockComponentRegistry;
  for (const id of COMPONENTS) {
    reg.registerCustomComponent(id, { onPlayerInteract() {} });
  }
  console.log("[SocietyCore] Components registered");
});

world.afterEvents.worldLoad.subscribe(() => {
  society.load();
  setupUIHandlers(society);
  console.log("[SocietyCore] Institutions online");
});

system.runInterval(() => {
  society.tick();
}, 20);

console.log("[SocietyCore] Script started");
