import { world } from "@minecraft/server";

const SAVE = "societycore:state";
const NEWS_BRIDGE = "carriercore:news_bridge";
const POWER_BRIDGE = "carriercore:power_bridge";
const FINANCE_SCORE = "financecore:state";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function id(prefix, n) {
  return `${prefix}_${n}`;
}

export class SocietyManager {
  constructor() {
    this.next = {
      case: 1, tax: 1, vote: 1, job: 1, cert: 1, permit: 1, plate: 1,
      booking: 1, lease: 1, sub: 1, parcel: 1, flight: 1, contract: 1,
      news: 1, lien: 1, claim: 1, loyalty: 1
    };
    // Civic
    this.tickets = [];
    this.cases = new Map();
    this.taxFilings = new Map();
    this.votes = [];
    this.dispatches = [];
    // Work
    this.jobs = [];
    this.employments = new Map(); // player -> job
    this.certificates = new Map(); // player -> [certs]
    this.strike = { active: false, industries: [] };
    // Industry
    this.market = { ore: 40, crop: 12, fuel: 18, tick: 0 };
    this.permits = new Map();
    this.waste = { landfill: 0, capacity: 10000, lastPickup: 0 };
    // Mobility
    this.plates = new Map();
    this.containers = new Map();
    this.flights = [];
    this.hotelRooms = new Map();
    // Risk
    this.bureau = new Map(); // player -> score
    this.liens = [];
    this.contracts = new Map();
    this.fraudFlags = [];
    // Soft
    this.news = [];
    this.weather = { condition: "clear", wind: 5, updatedAt: 0 };
    this.parcels = new Map(); // survey stakes
    this.time = { businessOpen: true, dayIndex: 0 };
    // Consumer
    this.leases = new Map();
    this.subs = new Map();
    this.warranties = new Map();
    this.loyalty = new Map();
    // Institutions
    this.centralBank = { prime: 0.0495, inflation: 0.02, reserves: 1000000 };
    this.fx = { USD: 1.35, CRYPTO: 0.001 };
    this.clearing = [];
    this.settings = {};
    this._tick = 0;
  }

  load() {
    try {
      const raw = world.getDynamicProperty(SAVE);
      if (!raw || typeof raw !== "string") return;
      const d = JSON.parse(raw);
      for (const k of Object.keys(d)) {
        if (k.startsWith("_")) continue;
        const v = d[k];
        if (v && v.__map) this[k] = new Map(v.entries);
        else this[k] = v;
      }
    } catch (e) {
      console.warn("[SocietyCore] load", e);
    }
  }

  save() {
    try {
      const out = {};
      for (const [k, v] of Object.entries(this)) {
        if (typeof v === "function" || k === "_tick") continue;
        if (v instanceof Map) out[k] = { __map: true, entries: [...v.entries()] };
        else out[k] = v;
      }
      world.setDynamicProperty(SAVE, JSON.stringify(out));
    } catch (e) {
      console.warn("[SocietyCore] save", e);
    }
  }

  // ===== Credit bureau =====
  getScore(player) {
    if (!this.bureau.has(player)) this.bureau.set(player, { score: 680, hist: [] });
    return this.bureau.get(player);
  }
  adjustScore(player, delta, reason) {
    const s = this.getScore(player);
    s.score = Math.max(300, Math.min(900, s.score + delta));
    s.hist.push({ delta, reason, at: Date.now(), score: s.score });
    if (s.hist.length > 20) s.hist = s.hist.slice(-20);
    this.save();
    return s;
  }

  // ===== Court =====
  issueTicket(toPlayer, offense, amount, issuer) {
    const t = {
      id: id("tkt", this.next.case++),
      to: toPlayer,
      offense: String(offense).slice(0, 40),
      amount: round2(amount),
      issuer,
      status: "unpaid",
      at: Date.now()
    };
    this.tickets.push(t);
    this.adjustScore(toPlayer, -5, "Ticket");
    this.pushNews(`Ticket issued to ${toPlayer}: ${offense}`);
    this.save();
    return t;
  }

  fileCase(plaintiff, defendant, claim, amount) {
    const c = {
      id: id("case", this.next.case++),
      plaintiff,
      defendant,
      claim: String(claim).slice(0, 60),
      amount: round2(amount || 0),
      status: "filed",
      judgment: null,
      at: Date.now()
    };
    this.cases.set(c.id, c);
    this.save();
    return c;
  }

  judgeCase(caseId, forPlaintiff, note) {
    const c = this.cases.get(caseId);
    if (!c || c.status === "closed") return { ok: false, error: "Case not found" };
    c.status = "closed";
    c.judgment = {
      forPlaintiff: !!forPlaintiff,
      note: String(note || "").slice(0, 60),
      at: Date.now()
    };
    if (forPlaintiff) {
      this.adjustScore(c.defendant, -15, "Judgment against");
      this.liens.push({
        id: id("lien", this.next.lien++),
        against: c.defendant,
        amount: c.amount,
        reason: c.claim,
        at: Date.now()
      });
      // garnish via finance bridge tag
      this._garnish(c.defendant, c.amount);
    } else {
      this.adjustScore(c.plaintiff, -2, "Case dismissed");
    }
    this.save();
    return { ok: true, case: c };
  }

  _garnish(playerName, amount) {
    try {
      const raw = world.getDynamicProperty(FINANCE_SCORE);
      if (!raw || typeof raw !== "string") return;
      const fin = JSON.parse(raw);
      const accounts = fin.accounts || [];
      for (let i = 0; i < accounts.length; i++) {
        const e = accounts[i];
        const acc = Array.isArray(e) ? e[1] : e;
        if (acc && acc.owner === playerName && acc.status === "open" && acc.type !== "credit") {
          const take = Math.min(acc.balance || 0, amount);
          acc.balance = round2((acc.balance || 0) - take);
          if (!acc.ledger) acc.ledger = [];
          acc.ledger.push({ type: "garnishment", amount: -take, note: "Court order", at: Date.now() });
          if (Array.isArray(e)) accounts[i] = [e[0], acc];
          fin.accounts = accounts;
          world.setDynamicProperty(FINANCE_SCORE, JSON.stringify(fin));
          return;
        }
      }
    } catch (e) {}
  }

  // ===== Tax =====
  fileTax(player, income, propertyValue) {
    const incomeTax = round2(Math.max(0, income) * 0.15);
    const propTax = round2(Math.max(0, propertyValue) * 0.01);
    const total = round2(incomeTax + propTax);
    const f = {
      id: id("tax", this.next.tax++),
      player,
      income: round2(income),
      propertyValue: round2(propertyValue),
      incomeTax,
      propTax,
      total,
      status: "filed",
      refund: total < 0 ? Math.abs(total) : 0,
      at: Date.now()
    };
    this.taxFilings.set(f.id, f);
    this._garnish(player, total);
    this.adjustScore(player, 3, "Tax filed");
    this.save();
    return f;
  }

  // ===== Votes =====
  createVote(title, options, hours = 1) {
    const v = {
      id: id("vote", this.next.vote++),
      title: String(title).slice(0, 40),
      options: (options || []).slice(0, 6).map((o) => String(o).slice(0, 24)),
      tallies: {},
      voters: [],
      closesAt: Date.now() + hours * 60 * 1000,
      status: "open",
      zoningEffect: null
    };
    for (const o of v.options) v.tallies[o] = 0;
    this.votes.push(v);
    this.pushNews(`Vote open: ${v.title}`);
    this.save();
    return v;
  }

  castVote(voteId, player, option) {
    const v = this.votes.find((x) => x.id === voteId);
    if (!v || v.status !== "open") return { ok: false, error: "Vote closed" };
    if (v.voters.includes(player)) return { ok: false, error: "Already voted" };
    if (!v.tallies.hasOwnProperty(option)) return { ok: false, error: "Bad option" };
    v.tallies[option]++;
    v.voters.push(player);
    this.save();
    return { ok: true };
  }

  // ===== Emergency =====
  dispatch(type, location, caller) {
    const d = {
      id: id("em", this.next.case++),
      type: type || "general",
      location: String(location).slice(0, 40),
      caller,
      status: "active",
      at: Date.now()
    };
    this.dispatches.push(d);
    if (this.dispatches.length > 40) this.dispatches = this.dispatches.slice(-40);
    this.pushNews(`911 ${type} @ ${location}`);
    try {
      for (const p of world.getAllPlayers()) {
        if (p.hasTag("ems") || p.hasTag("police") || p.hasTag("fire") || p.isOp?.()) {
          p.sendMessage(`§c[Dispatch] §f${type} §7@ ${location} §8(${d.id})`);
        }
      }
    } catch (e) {}
    this.save();
    return d;
  }

  // ===== Labor =====
  postJob(title, industry, employer, wage) {
    const j = {
      id: id("job", this.next.job++),
      title: String(title).slice(0, 32),
      industry: industry || "general",
      employer,
      wage: round2(wage || 100),
      open: true
    };
    this.jobs.push(j);
    this.save();
    return j;
  }

  applyJob(player, jobId) {
    if (this.strike.active) {
      const j = this.jobs.find((x) => x.id === jobId);
      if (j && this.strike.industries.includes(j.industry)) {
        return { ok: false, error: "Industry on strike" };
      }
    }
    const j = this.jobs.find((x) => x.id === jobId && x.open);
    if (!j) return { ok: false, error: "Job not found" };
    this.employments.set(player, { jobId: j.id, title: j.title, wage: j.wage, industry: j.industry });
    this.save();
    return { ok: true, job: j };
  }

  setStrike(active, industries = []) {
    this.strike = { active: !!active, industries: industries || [] };
    this.pushNews(active ? `Strike: ${(industries || []).join(", ")}` : "Strike ended");
    this.save();
  }

  // ===== Education =====
  grantCert(player, course) {
    const list = this.certificates.get(player) || [];
    const cert = { course: String(course).slice(0, 32), at: Date.now(), id: id("cert", this.next.cert++) };
    list.push(cert);
    this.certificates.set(player, list);
    this.adjustScore(player, 5, "Certificate");
    this.save();
    return cert;
  }

  hasCert(player, course) {
    const list = this.certificates.get(player) || [];
    return list.some((c) => c.course.toLowerCase() === String(course).toLowerCase());
  }

  // ===== Permits =====
  requestPermit(player, structure, x, y, z) {
    const p = {
      id: id("perm", this.next.permit++),
      player,
      structure: String(structure).slice(0, 40),
      x, y, z,
      status: "pending",
      at: Date.now()
    };
    this.permits.set(p.id, p);
    this.save();
    return p;
  }

  inspectPermit(permitId, pass, inspector) {
    const p = this.permits.get(permitId);
    if (!p) return { ok: false, error: "Not found" };
    p.status = pass ? "approved" : "failed";
    p.inspector = inspector;
    if (!pass) {
      this.issueTicket(p.player, "Failed building inspection", 250, inspector);
    }
    this.save();
    return { ok: true, permit: p };
  }

  // ===== Market / industry =====
  tickMarket() {
    this.market.tick++;
    const wobble = () => 1 + (Math.random() * 0.06 - 0.03);
    this.market.ore = round2(Math.max(5, this.market.ore * wobble()));
    this.market.crop = round2(Math.max(2, this.market.crop * wobble()));
    this.market.fuel = round2(Math.max(5, this.market.fuel * wobble()));
  }

  // ===== Waste =====
  dumpWaste(amount) {
    this.waste.landfill = Math.min(this.waste.capacity, (this.waste.landfill || 0) + amount);
    if (this.waste.landfill >= this.waste.capacity) {
      this.pushNews("Landfill at capacity");
    }
    this.save();
    return this.waste;
  }

  pickupWaste() {
    const taken = Math.min(this.waste.landfill, 500);
    this.waste.landfill -= taken;
    this.waste.lastPickup = Date.now();
    this.save();
    return taken;
  }

  // ===== Plates =====
  registerVehicle(player, make) {
    const plate = `BL${String(this.next.plate++).padStart(4, "0")}`;
    const rec = { plate, owner: player, make: String(make).slice(0, 24), insured: false, impounded: false };
    this.plates.set(plate, rec);
    this.save();
    return rec;
  }

  // ===== Hotel =====
  bookRoom(player, nights = 1) {
    const room = `R${100 + (this.next.booking % 50)}`;
    const b = {
      id: id("htl", this.next.booking++),
      player,
      room,
      nights: Math.max(1, nights),
      until: Date.now() + nights * 60 * 1000,
      status: "booked"
    };
    this.hotelRooms.set(b.id, b);
    this.save();
    return b;
  }

  // ===== Flights =====
  planFlight(player, from, to, cargo) {
    const f = {
      id: id("flt", this.next.flight++),
      pilot: player,
      from: String(from).slice(0, 16),
      to: String(to).slice(0, 16),
      cargo: String(cargo || "").slice(0, 24),
      status: "planned",
      at: Date.now()
    };
    this.flights.push(f);
    this.save();
    return f;
  }

  // ===== Port =====
  createContainer(owner, contents) {
    const c = {
      id: id("ctr", this.next.parcel++),
      owner,
      contents: String(contents).slice(0, 40),
      status: "in_port",
      hold: false,
      tariff: 25
    };
    this.containers.set(c.id, c);
    this.save();
    return c;
  }

  // ===== Notary / Title =====
  notarize(partyA, partyB, subject) {
    const c = {
      id: id("ctrct", this.next.contract++),
      partyA,
      partyB,
      subject: String(subject).slice(0, 60),
      sealed: true,
      at: Date.now()
    };
    this.contracts.set(c.id, c);
    this.save();
    return c;
  }

  // ===== Lease / Sub / Warranty / Loyalty =====
  createLease(landlord, tenant, rent) {
    const l = {
      id: id("lease", this.next.lease++),
      landlord,
      tenant,
      rent: round2(rent),
      deposit: round2(rent),
      status: "active",
      at: Date.now()
    };
    this.leases.set(l.id, l);
    this.save();
    return l;
  }

  startSub(player, service, monthly) {
    const s = {
      id: id("sub", this.next.sub++),
      player,
      service: String(service).slice(0, 24),
      monthly: round2(monthly),
      nextBill: Date.now() + 20 * 60 * 1000,
      active: true
    };
    this.subs.set(s.id, s);
    this.save();
    return s;
  }

  addWarranty(player, itemName, days) {
    const w = {
      id: id("war", this.next.claim++),
      player,
      item: String(itemName).slice(0, 32),
      until: Date.now() + Math.max(1, days) * 60 * 1000
    };
    this.warranties.set(w.id, w);
    this.save();
    return w;
  }

  claimWarranty(player, warId) {
    const w = this.warranties.get(warId);
    if (!w || w.player !== player) return { ok: false, error: "Not found" };
    if (Date.now() > w.until) return { ok: false, error: "Expired — claim denied" };
    w.claimed = true;
    this.save();
    return { ok: true, warranty: w };
  }

  loyaltyPoints(player, delta) {
    const L = this.loyalty.get(player) || { points: 0 };
    L.points = Math.max(0, (L.points || 0) + delta);
    this.loyalty.set(player, L);
    this.save();
    return L;
  }

  // ===== News / Weather / Time / Map =====
  pushNews(headline) {
    const n = { id: id("news", this.next.news++), headline: String(headline).slice(0, 80), at: Date.now() };
    this.news.unshift(n);
    if (this.news.length > 30) this.news = this.news.slice(0, 30);
    try {
      world.setDynamicProperty(
        NEWS_BRIDGE,
        JSON.stringify({ headlines: this.news.slice(0, 10), at: Date.now() })
      );
    } catch (e) {}
  }

  setWeather(condition, wind) {
    this.weather = { condition: condition || "clear", wind: Number(wind) || 5, updatedAt: Date.now() };
    this.pushNews(`Weather: ${this.weather.condition}, wind ${this.weather.wind}`);
    this.save();
  }

  registerParcel(player, x, y, z, dim, label) {
    const key = `${dim}:${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
    const p = {
      key,
      owner: player,
      label: String(label || "Lot").slice(0, 24),
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
      dim
    };
    this.parcels.set(key, p);
    this.save();
    return p;
  }

  // ===== Central bank / FX / clearing =====
  setPrime(rate) {
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0 || r > 0.3) return { ok: false };
    this.centralBank.prime = r;
    this.pushNews(`Prime rate set to ${(r * 100).toFixed(2)}%`);
    this.save();
    return { ok: true };
  }

  quoteFx(currency) {
    return this.fx[currency] || null;
  }

  queueClearing(type, amount, meta) {
    this.clearing.push({ type, amount: round2(amount), meta, at: Date.now(), status: "pending" });
    if (this.clearing.length > 50) this.clearing = this.clearing.slice(-50);
    this.save();
  }

  processClearing() {
    for (const c of this.clearing) {
      if (c.status === "pending" && Date.now() - c.at > 60 * 1000) c.status = "settled";
    }
  }

  // ===== Fraud =====
  flagFraud(player, reason) {
    this.fraudFlags.push({ player, reason: String(reason).slice(0, 40), at: Date.now() });
    if (this.fraudFlags.length > 40) this.fraudFlags = this.fraudFlags.slice(-40);
    this.adjustScore(player, -25, "Fraud flag");
    this.pushNews(`Fraud desk alert: ${player}`);
    this.save();
  }

  // ===== Tick =====
  tick() {
    this._tick++;
    if (this._tick % 1200 === 0) {
      this.time.dayIndex++;
      this.time.businessOpen = true;
      this.tickMarket();
    }
    if (this._tick % 100 === 0) {
      this.processClearing();
      // close votes
      for (const v of this.votes) {
        if (v.status === "open" && Date.now() > v.closesAt) {
          v.status = "closed";
          let winner = null;
          let best = -1;
          for (const [opt, n] of Object.entries(v.tallies)) {
            if (n > best) {
              best = n;
              winner = opt;
            }
          }
          v.winner = winner;
          this.pushNews(`Vote closed: ${v.title} → ${winner}`);
        }
      }
      // pull power outages into news once
      try {
        const raw = world.getDynamicProperty(POWER_BRIDGE);
        if (raw && typeof raw === "string") {
          const p = JSON.parse(raw);
          if (p && p.gridOnline === false && this._tick % 400 === 0) {
            this.pushNews("Grid offline — outages reported");
          }
        }
      } catch (e) {}
      this.save();
    }
  }
}
