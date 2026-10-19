import { ActionFormData, ModalFormData } from "@minecraft/server-ui";
import { system, world } from "@minecraft/server";

function nextForm(fn) {
  system.run(() => {
    try {
      fn();
    } catch (e) {
      console.warn("[SocietyCore] form", e);
    }
  });
}

function parseAmt(raw) {
  const n = Number(String(raw || "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

const BLOCK_MENU = {
  "societycore:civic_hub": "hub",
  "societycore:court_bench": "court",
  "societycore:tax_office": "tax",
  "societycore:job_board": "labor",
  "societycore:school_desk": "edu",
  "societycore:permit_desk": "permit",
  "societycore:waste_bin": "waste",
  "societycore:survey_stake": "map",
  "societycore:hotel_desk": "hotel",
  "societycore:dispatch_console": "emergency",
  "societycore:customs_desk": "port",
  "societycore:notary_desk": "notary"
};

export function setupUIHandlers(soc) {
  world.afterEvents.itemUse.subscribe((ev) => {
    const item = ev.itemStack;
    if (!item) return;
    if (item.typeId === "societycore:civic_tablet") {
      nextForm(() => showHub(ev.source, soc));
    }
  });

  world.afterEvents.playerInteractWithBlock.subscribe((ev) => {
    const kind = BLOCK_MENU[ev.block?.typeId];
    if (!kind) return;
    ev.cancel = true;
    const p = ev.player;
    if (kind === "hub") nextForm(() => showHub(p, soc));
    else if (kind === "court") nextForm(() => showCourt(p, soc));
    else if (kind === "tax") nextForm(() => showTax(p, soc));
    else if (kind === "labor") nextForm(() => showLabor(p, soc));
    else if (kind === "edu") nextForm(() => showEdu(p, soc));
    else if (kind === "permit") nextForm(() => showPermit(p, soc));
    else if (kind === "waste") nextForm(() => showWaste(p, soc));
    else if (kind === "map") nextForm(() => showMap(p, soc, ev.block));
    else if (kind === "hotel") nextForm(() => showHotel(p, soc));
    else if (kind === "emergency") nextForm(() => showEmergency(p, soc));
    else if (kind === "port") nextForm(() => showPort(p, soc));
    else if (kind === "notary") nextForm(() => showNotary(p, soc));
  });
}

function showHub(player, soc) {
  const score = soc.getScore(player.name).score;
  new ActionFormData()
    .title("SocietyCore Hub")
    .body(`Credit bureau: ${score}\nPrime: ${(soc.centralBank.prime * 100).toFixed(2)}%\nDay ${soc.time.dayIndex}`)
    .button("Court & tickets")
    .button("Tax")
    .button("Votes")
    .button("Emergency 911")
    .button("Jobs & labor")
    .button("Education")
    .button("Permits")
    .button("Market prices")
    .button("Waste")
    .button("Vehicles / plates")
    .button("Hotel")
    .button("Air / flights")
    .button("Port / containers")
    .button("Notary & title liens")
    .button("News & weather")
    .button("Lease / subs / warranty / loyalty")
    .button("Central bank & FX")
    .button("Fraud desk")
    .button("Close")
    .show(player)
    .then((res) => {
      if (res.canceled || res.selection === 18) return;
      const map = [
        showCourt, showTax, showVotes, showEmergency, showLabor, showEdu, showPermit,
        showMarket, showWaste, showPlates, showHotel, showAir, showPort, showNotary,
        showNews, showConsumer, showCentral, showFraud
      ];
      const fn = map[res.selection];
      if (fn) nextForm(() => fn(player, soc));
    });
}

function showCourt(player, soc) {
  new ActionFormData()
    .title("Court")
    .button("Issue ticket")
    .button("File case")
    .button("Judge open case")
    .button("My tickets")
    .button("Back")
    .show(player)
    .then((res) => {
      if (res.canceled || res.selection === 4) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Ticket").textField("Player", "").textField("Offense", "Speeding").textField("Fine", "100")
            .show(player).then((r) => {
              if (r.canceled) return;
              const amt = parseAmt(r.formValues[2]) ?? 100;
              const t = soc.issueTicket(String(r.formValues[0]).trim(), r.formValues[1], amt, player.name);
              player.sendMessage(`§aTicket ${t.id}`);
            });
        });
      }
      if (res.selection === 1) {
        nextForm(() => {
          new ModalFormData().title("File case").textField("Defendant", "").textField("Claim", "").textField("Amount", "500")
            .show(player).then((r) => {
              if (r.canceled) return;
              const c = soc.fileCase(player.name, String(r.formValues[0]).trim(), r.formValues[1], parseAmt(r.formValues[2]) ?? 0);
              player.sendMessage(`§aCase ${c.id}`);
            });
        });
      }
      if (res.selection === 2) {
        const open = [...soc.cases.values()].filter((c) => c.status === "filed");
        if (!open.length) return player.sendMessage("§7No open cases");
        const f = new ActionFormData().title("Judge");
        for (const c of open.slice(0, 10)) f.button(`${c.id}\n${c.plaintiff} v ${c.defendant}`);
        f.show(player).then((r) => {
          if (r.canceled) return;
          const c = open[r.selection];
          nextForm(() => {
            new ActionFormData().title(c.id).button("For plaintiff").button("Dismiss").show(player).then((r2) => {
              if (r2.canceled) return;
              const out = soc.judgeCase(c.id, r2.selection === 0, "");
              player.sendMessage(out.ok ? "§aJudgment entered" : `§c${out.error}`);
            });
          });
        });
      }
      if (res.selection === 3) {
        const mine = soc.tickets.filter((t) => t.to === player.name).slice(-8);
        player.sendMessage(mine.length ? mine.map((t) => `${t.id} ${t.offense} $${t.amount} ${t.status}`).join("\n") : "§7None");
      }
    });
}

function showTax(player, soc) {
  new ModalFormData().title("Tax filing").textField("Income", "10000").textField("Property value", "50000")
    .show(player).then((r) => {
      if (r.canceled) return;
      const f = soc.fileTax(player.name, parseAmt(r.formValues[0]) ?? 0, parseAmt(r.formValues[1]) ?? 0);
      player.sendMessage(`§aFiled ${f.id} tax due $${f.total}`);
    });
}

function showVotes(player, soc) {
  new ActionFormData().title("Municipal votes").button("Create vote").button("Cast vote").button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 2) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("New vote").textField("Title", "Zoning").textField("Option A", "Approve").textField("Option B", "Reject")
            .show(player).then((r) => {
              if (r.canceled) return;
              const v = soc.createVote(r.formValues[0], [r.formValues[1], r.formValues[2]], 1);
              player.sendMessage(`§aVote ${v.id}`);
            });
        });
      }
      if (res.selection === 1) {
        const open = soc.votes.filter((v) => v.status === "open");
        if (!open.length) return player.sendMessage("§7No open votes");
        const f = new ActionFormData().title("Open votes");
        for (const v of open) f.button(v.title);
        f.show(player).then((r) => {
          if (r.canceled) return;
          const v = open[r.selection];
          nextForm(() => {
            const f2 = new ActionFormData().title(v.title);
            for (const o of v.options) f2.button(o);
            f2.show(player).then((r2) => {
              if (r2.canceled) return;
              const out = soc.castVote(v.id, player.name, v.options[r2.selection]);
              player.sendMessage(out.ok ? "§aVoted" : `§c${out.error}`);
            });
          });
        });
      }
    });
}

function showEmergency(player, soc) {
  new ModalFormData().title("911 Dispatch").textField("Type (fire/police/ems)", "ems").textField("Location", "Spawn")
    .show(player).then((r) => {
      if (r.canceled) return;
      const d = soc.dispatch(r.formValues[0], r.formValues[1], player.name);
      player.sendMessage(`§cDispatch ${d.id}`);
    });
}

function showLabor(player, soc) {
  new ActionFormData().title("Labor").button("Post job").button("Browse jobs").button("Toggle strike (ops)").button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 3) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Post job").textField("Title", "Teller").textField("Industry", "finance").textField("Wage", "200")
            .show(player).then((r) => {
              if (r.canceled) return;
              const j = soc.postJob(r.formValues[0], r.formValues[1], player.name, parseAmt(r.formValues[2]) ?? 100);
              player.sendMessage(`§aJob ${j.id}`);
            });
        });
      }
      if (res.selection === 1) {
        const open = soc.jobs.filter((j) => j.open).slice(-12);
        if (!open.length) return player.sendMessage("§7No jobs");
        const f = new ActionFormData().title("Jobs");
        for (const j of open) f.button(`${j.title}\n${j.industry} $${j.wage}`);
        f.show(player).then((r) => {
          if (r.canceled) return;
          const out = soc.applyJob(player.name, open[r.selection].id);
          player.sendMessage(out.ok ? `§aHired as ${out.job.title}` : `§c${out.error}`);
        });
      }
      if (res.selection === 2) {
        soc.setStrike(!soc.strike.active, ["finance", "mining", "logistics"]);
        player.sendMessage(soc.strike.active ? "§eStrike ON" : "§aStrike OFF");
      }
    });
}

function showEdu(player, soc) {
  const courses = ["Teller Certificate", "Tower Tech", "Pilot License", "Inspector"];
  const f = new ActionFormData().title("Education").body("Complete a course for a certificate");
  for (const c of courses) f.button(c);
  f.button("My certificates").button("Back");
  f.show(player).then((res) => {
    if (res.canceled || res.selection === courses.length + 1) return;
    if (res.selection === courses.length) {
      const list = soc.certificates.get(player.name) || [];
      player.sendMessage(list.length ? list.map((c) => c.course).join(", ") : "§7None");
      return;
    }
    const cert = soc.grantCert(player.name, courses[res.selection]);
    player.sendMessage(`§aEarned: ${cert.course}`);
  });
}

function showPermit(player, soc) {
  new ActionFormData().title("Building permits").button("Request permit").button("Inspect pending").button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 2) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Permit").textField("Structure name", "Warehouse")
            .show(player).then((r) => {
              if (r.canceled) return;
              const loc = player.location;
              const p = soc.requestPermit(player.name, r.formValues[0], loc.x, loc.y, loc.z);
              player.sendMessage(`§aPermit ${p.id} pending`);
            });
        });
      }
      if (res.selection === 1) {
        const pending = [...soc.permits.values()].filter((p) => p.status === "pending");
        if (!pending.length) return player.sendMessage("§7None pending");
        const f = new ActionFormData().title("Inspect");
        for (const p of pending.slice(0, 10)) f.button(`${p.id}\n${p.structure}`);
        f.show(player).then((r) => {
          if (r.canceled) return;
          nextForm(() => {
            new ActionFormData().title("Result").button("Pass").button("Fail").show(player).then((r2) => {
              if (r2.canceled) return;
              soc.inspectPermit(pending[r.selection].id, r2.selection === 0, player.name);
              player.sendMessage("§aInspection recorded");
            });
          });
        });
      }
    });
}

function showMarket(player, soc) {
  const m = soc.market;
  player.sendMessage(`§eMarket §7ore $${m.ore} crop $${m.crop} fuel $${m.fuel}`);
}

function showWaste(player, soc) {
  new ActionFormData()
    .title("Waste")
    .body(`Landfill ${soc.waste.landfill}/${soc.waste.capacity}`)
    .button("Dump 50 units")
    .button("Municipal pickup")
    .button("Back")
    .show(player)
    .then((res) => {
      if (res.canceled || res.selection === 2) return;
      if (res.selection === 0) {
        soc.dumpWaste(50);
        player.sendMessage("§aDumped");
      }
      if (res.selection === 1) {
        const n = soc.pickupWaste();
        player.sendMessage(`§aPicked up ${n}`);
      }
    });
}

function showMap(player, soc, block) {
  const p = soc.registerParcel(player.name, block.x, block.y, block.z, block.dimension.id, "Lot");
  player.sendMessage(`§aSurvey parcel ${p.key}`);
}

function showPlates(player, soc) {
  new ModalFormData().title("Vehicle registration").textField("Make/model", "Sedan")
    .show(player).then((r) => {
      if (r.canceled) return;
      const rec = soc.registerVehicle(player.name, r.formValues[0]);
      player.sendMessage(`§aPlate ${rec.plate}`);
    });
}

function showHotel(player, soc) {
  const b = soc.bookRoom(player.name, 1);
  player.sendMessage(`§aBooked room ${b.room} (${b.id})`);
}

function showAir(player, soc) {
  nextForm(() => {
    new ModalFormData().title("Flight plan").textField("From", "SPAWN").textField("To", "NORTH").textField("Cargo", "")
      .show(player).then((r) => {
        if (r.canceled) return;
        const f = soc.planFlight(player.name, r.formValues[0], r.formValues[1], r.formValues[2]);
        player.sendMessage(`§aFlight ${f.id}`);
      });
  });
}

function showPort(player, soc) {
  nextForm(() => {
    new ModalFormData().title("Container").textField("Contents", "Goods")
      .show(player).then((r) => {
        if (r.canceled) return;
        const c = soc.createContainer(player.name, r.formValues[0]);
        player.sendMessage(`§aContainer ${c.id} tariff $${c.tariff}`);
      });
  });
}

function showNotary(player, soc) {
  new ActionFormData().title("Notary / Title").button("Seal contract").button("List my liens").button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 2) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Contract").textField("Other party", "").textField("Subject", "Sale of base")
            .show(player).then((r) => {
              if (r.canceled) return;
              const c = soc.notarize(player.name, String(r.formValues[0]).trim(), r.formValues[1]);
              player.sendMessage(`§aContract ${c.id} sealed`);
            });
        });
      }
      if (res.selection === 1) {
        const liens = soc.liens.filter((l) => l.against === player.name);
        player.sendMessage(liens.length ? liens.map((l) => `${l.id} $${l.amount} ${l.reason}`).join("\n") : "§7No liens");
      }
    });
}

function showNews(player, soc) {
  new ActionFormData().title("News & weather")
    .body(`Weather: ${soc.weather.condition} wind ${soc.weather.wind}`)
    .button("Headlines")
    .button("Set weather")
    .button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 2) return;
      if (res.selection === 0) {
        const lines = soc.news.slice(0, 8).map((n) => n.headline).join("\n");
        player.sendMessage(lines || "§7No headlines");
      }
      if (res.selection === 1) {
        nextForm(() => {
          new ModalFormData().title("Weather").textField("Condition", "clear").textField("Wind", "5")
            .show(player).then((r) => {
              if (r.canceled) return;
              soc.setWeather(r.formValues[0], r.formValues[1]);
              player.sendMessage("§aWeather updated");
            });
        });
      }
    });
}

function showConsumer(player, soc) {
  new ActionFormData().title("Consumer")
    .button("Create lease")
    .button("Start subscription")
    .button("Add warranty")
    .button("Claim warranty")
    .button("Loyalty +10")
    .button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 5) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Lease").textField("Tenant", "").textField("Rent", "50")
            .show(player).then((r) => {
              if (r.canceled) return;
              const l = soc.createLease(player.name, String(r.formValues[0]).trim(), parseAmt(r.formValues[1]) ?? 50);
              player.sendMessage(`§aLease ${l.id}`);
            });
        });
      }
      if (res.selection === 1) {
        nextForm(() => {
          new ModalFormData().title("Subscription").textField("Service", "Stream+").textField("Monthly", "15")
            .show(player).then((r) => {
              if (r.canceled) return;
              const s = soc.startSub(player.name, r.formValues[0], parseAmt(r.formValues[1]) ?? 15);
              player.sendMessage(`§aSub ${s.id}`);
            });
        });
      }
      if (res.selection === 2) {
        nextForm(() => {
          new ModalFormData().title("Warranty").textField("Item", "Phone").textField("Days (game mins)", "30")
            .show(player).then((r) => {
              if (r.canceled) return;
              const w = soc.addWarranty(player.name, r.formValues[0], Number(r.formValues[1]) || 30);
              player.sendMessage(`§aWarranty ${w.id}`);
            });
        });
      }
      if (res.selection === 3) {
        const list = [...soc.warranties.values()].filter((w) => w.player === player.name && !w.claimed);
        if (!list.length) return player.sendMessage("§7No warranties");
        const f = new ActionFormData().title("Claim");
        for (const w of list) f.button(w.item + "\n" + w.id);
        f.show(player).then((r) => {
          if (r.canceled) return;
          const out = soc.claimWarranty(player.name, list[r.selection].id);
          player.sendMessage(out.ok ? "§aClaim approved" : `§c${out.error}`);
        });
      }
      if (res.selection === 4) {
        const L = soc.loyaltyPoints(player.name, 10);
        player.sendMessage(`§aLoyalty points: ${L.points}`);
      }
    });
}

function showCentral(player, soc) {
  new ActionFormData().title("Central bank & FX")
    .body(`Prime ${(soc.centralBank.prime * 100).toFixed(2)}%\nUSD ${soc.fx.USD}`)
    .button("Set prime rate")
    .button("FX quotes")
    .button("Queue clearing sample")
    .button("Back")
    .show(player).then((res) => {
      if (res.canceled || res.selection === 3) return;
      if (res.selection === 0) {
        nextForm(() => {
          new ModalFormData().title("Prime").textField("Rate", String(soc.centralBank.prime))
            .show(player).then((r) => {
              if (r.canceled) return;
              soc.setPrime(r.formValues[0]);
              player.sendMessage("§aPrime updated");
            });
        });
      }
      if (res.selection === 1) player.sendMessage(`§eUSD ${soc.fx.USD} · CRYPTO ${soc.fx.CRYPTO}`);
      if (res.selection === 2) {
        soc.queueClearing("wire", 100, { by: player.name });
        player.sendMessage("§aClearing item queued (settles ~1 min)");
      }
    });
}

function showFraud(player, soc) {
  nextForm(() => {
    new ModalFormData().title("Fraud desk").textField("Player", "").textField("Reason", "Pattern match")
      .show(player).then((r) => {
        if (r.canceled) return;
        soc.flagFraud(String(r.formValues[0]).trim(), r.formValues[1]);
        player.sendMessage("§cFlag recorded");
      });
  });
}
