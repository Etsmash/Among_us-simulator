'use strict';

// ═════════════════════════════════════════════════════════════════════════
// THE SKELD – MAP DATA
// ═════════════════════════════════════════════════════════════════════════

const SKELD_CONNECTIONS = {
  cafeteria:      ["weapons", "medbay", "upper_engine"],
  weapons:        ["cafeteria", "navigation", "o2"],
  navigation:     ["weapons", "shields"],
  o2:             ["weapons", "admin", "shields"],
  shields:        ["navigation", "o2", "communications", "admin"],
  communications: ["shields", "storage"],
  storage:        ["communications", "admin", "electrical", "lower_engine"],
  admin:          ["o2", "shields", "storage", "medbay"],
  electrical:     ["storage", "lower_engine", "security"],
  lower_engine:   ["electrical", "storage", "reactor"],
  security:       ["electrical", "reactor", "upper_engine"],
  reactor:        ["security", "upper_engine", "lower_engine"],
  upper_engine:   ["reactor", "security", "cafeteria"],
  medbay:         ["cafeteria", "admin"],
};

const VENT_NETWORKS = [
  ["security", "cafeteria", "medbay"],
  ["reactor", "upper_engine", "electrical"],
  ["lower_engine", "storage", "admin"],
];
const VENT_CONN = {};
for (const net of VENT_NETWORKS)
  for (const r of net) VENT_CONN[r] = net.filter(x => x !== r);

const ROOM_NAMES = {
  cafeteria:"Cafeteria", weapons:"Weapons", navigation:"Navigation",
  o2:"O2", shields:"Shields", communications:"Communications",
  storage:"Storage", admin:"Admin", electrical:"Electrical",
  lower_engine:"Lower Engine", security:"Security", reactor:"Reactor",
  upper_engine:"Upper Engine", medbay:"MedBay",
};

const ROOM_TASKS = {
  cafeteria:      ["fix_wiring","empty_garbage","download_data"],
  weapons:        ["clear_asteroids","calibrate_distributor","download_data"],
  navigation:     ["chart_course","stabilize_steering","download_data"],
  o2:             ["clean_o2_filter","fix_wiring"],
  shields:        ["prime_shields"],
  communications: ["download_data","fix_wiring"],
  storage:        ["empty_garbage","fuel_engines"],
  admin:          ["swipe_card","fix_wiring"],
  electrical:     ["fix_wiring","calibrate_distributor","download_data"],
  lower_engine:   ["align_engine_output","fuel_engines"],
  security:       ["fix_wiring"],
  reactor:        ["start_reactor","unlock_manifolds"],
  upper_engine:   ["align_engine_output"],
  medbay:         ["submit_scan","inspect_sample"],
};

const TASK_INFO = {
  fix_wiring:           {name:"Fix Wiring",           dur:4},
  empty_garbage:        {name:"Empty Garbage",         dur:4},
  download_data:        {name:"Download Data",         dur:8},
  clear_asteroids:      {name:"Clear Asteroids",       dur:5},
  calibrate_distributor:{name:"Calibrate Distributor", dur:5},
  chart_course:         {name:"Chart Course",          dur:4},
  stabilize_steering:   {name:"Stabilize Steering",    dur:5},
  clean_o2_filter:      {name:"Clean O2 Filter",       dur:4},
  prime_shields:        {name:"Prime Shields",         dur:3},
  swipe_card:           {name:"Swipe Card",            dur:3},
  fuel_engines:         {name:"Fuel Engines",          dur:6},
  align_engine_output:  {name:"Align Engine Output",   dur:4},
  start_reactor:        {name:"Start Reactor",         dur:10},
  unlock_manifolds:     {name:"Unlock Manifolds",      dur:5},
  submit_scan:          {name:"Submit Scan",           dur:7},
  inspect_sample:       {name:"Inspect Sample",        dur:8},
};

const SABOTAGES = {
  lights:        {name:"Lights Out",        fix_room:"electrical",     dur:null,game_over:false,need:1},
  reactor:       {name:"Reactor Meltdown",  fix_room:"reactor",        dur:40,  game_over:true, need:2},
  o2:            {name:"O2 Depleted",       fix_room:"o2",             dur:30,  game_over:true, need:1},
  communications:{name:"Comms Sabotaged",   fix_room:"communications", dur:null,game_over:false,need:1},
};

// ═════════════════════════════════════════════════════════════════════════
// PLAYER
// ═════════════════════════════════════════════════════════════════════════

const PLAYER_COLORS = {
  Red:"#C51111", Blue:"#132ED1", Green:"#117F2D", Purple:"#6B2FBB",
  Yellow:"#F9F748", Orange:"#EF7D0E", Pink:"#EC54BB", Black:"#3F474E",
  White:"#D6DFF1", Brown:"#71491E", Cyan:"#38FEDC", Lime:"#50EF39",
};

let _uid = 0;

class Player {
  constructor(name, role) {
    this.id   = _uid++;
    this.name = name;
    this.color = PLAYER_COLORS[name] || "#AAAAAA";
    this.role  = role;           // "crewmate" | "impostor"
    this.alive = true;
    this.room  = "cafeteria";
    this.tasks = [];             // [{room, task, done}]
    this.currentTask = null;
    this.taskTimer   = 0;
    this.killCooldown     = 15;
    this.sabotageCooldown = 20;
    this.emergencyCooldown = ri(20, 40);
    this.voteDelay = 0;
    this.reported  = false;
  }
  snap() {
    return {
      id:   this.id, name: this.name, color: this.color,
      role: this.role, alive: this.alive, room: this.room,
      tasks_total: this.tasks.length,
      tasks_done:  this.tasks.filter(t=>t.done).length,
      current_task:      this.currentTask ? this.currentTask.task : null,
      current_task_room: this.currentTask ? this.currentTask.room : null,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// GAME ENGINE
// ═════════════════════════════════════════════════════════════════════════

class Game {
  constructor() {
    this.phase   = "lobby";
    this.tick    = 0;
    this.players = [];
    this.events  = [];
    this.votes   = {};
    this.meetingCaller = null;
    this.meetingType   = null;
    this.meetingBody   = null;
    this.meetingTimer  = 0;
    this.sabotage      = null;
    this.sabotageTimer = 0;
    this.winner        = null;
    this.meetingsHeld  = 0;
    this.totalKills    = 0;
    this.suspicion     = {};
    this._ivl          = null;

    this.numPlayers   = 10;
    this.numImpostors = 2;
    this.tickSpeed    = 1500;

    this.onChange = null;   // called with getState() each tick
  }

  configure(n, imp, ms) {
    this.numPlayers   = Math.max(4, Math.min(12, n));
    this.numImpostors = Math.max(1, Math.min(3, imp));
    this.tickSpeed    = ms;
  }

  start() {
    this.stop();
    _uid = 0;
    this._init();
    this._ivl = setInterval(() => this._tick(), this.tickSpeed);
  }

  stop() {
    if (this._ivl) { clearInterval(this._ivl); this._ivl = null; }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  _init() {
    this.phase  = "game";
    this.tick   = 0;
    this.events = [];
    this.winner = null;
    this.sabotage = null; this.sabotageTimer = 0;
    this.votes = {}; this.meetingCaller = null;
    this.meetingBody = null; this.meetingTimer = 0;
    this.meetingsHeld = 0; this.totalKills = 0;
    this.suspicion = {};

    const colors = shuffle(Object.keys(PLAYER_COLORS).slice(0, this.numPlayers));
    const roles  = shuffle([
      ...Array(this.numImpostors).fill("impostor"),
      ...Array(this.numPlayers - this.numImpostors).fill("crewmate"),
    ]);
    this.players = colors.map((c, i) => {
      const p = new Player(c, roles[i]);
      if (roles[i] === "crewmate") this._assignTasks(p);
      return p;
    });
    this._log("Game started on The Skeld!", "system");
    this._log(`${this.numPlayers} players – ${this.numImpostors} impostor(s).`, "system");
  }

  _assignTasks(p) {
    const pool = [];
    for (const [room, tasks] of Object.entries(ROOM_TASKS))
      for (const task of tasks) pool.push({room, task, done:false});
    p.tasks = shuffle(pool).slice(0, ri(5, 7));
  }

  // ── Main tick ───────────────────────────────────────────────────────────────────

  _tick() {
    this.tick++;
    if (this.phase === "game")    this._gameTick();
    else if (this.phase === "meeting") this._meetingTick();
    this._checkWin();
    if (this.onChange) this.onChange(this.state());
  }

  // ── Game tick ───────────────────────────────────────────────────────────────────

  _gameTick() {
    if (this.sabotage) {
      const info = SABOTAGES[this.sabotage.type];
      if (info.game_over) {
        this.sabotageTimer--;
        if (this.sabotageTimer <= 0) {
          this.phase = "ended"; this.winner = "impostors";
          this._log("Sabotage unfixed! Impostors win!", "sabotage");
          return;
        }
      }
    }
    for (const p of this.players) {
      if (this.phase !== "game") break;
      if (!p.alive) continue;
      p.role === "impostor" ? this._impAI(p) : this._crewAI(p);
    }
  }

  // ── Crewmate AI ───────────────────────────────────────────────────────────────────

  _crewAI(p) {
    // Critical sabotage first
    if (this.sabotage) {
      const info = SABOTAGES[this.sabotage.type];
      if (info.game_over) {
        if (p.room !== info.fix_room) {
          p.currentTask = null; p.taskTimer = 0;
          this._moveTo(p, info.fix_room);
        } else {
          this.sabotage.fixers.add(p.id);
          if (this.sabotage.fixers.size >= info.need) {
            this._log(`${p.name} fixed the ${info.name}!`, "system");
            this.sabotage = null;
          }
        }
        return;
      }
    }
    // Finish task
    if (p.currentTask) {
      p.taskTimer--;
      if (p.taskTimer <= 0) {
        p.currentTask.done = true;
        this._log(`${p.name} completed ${TASK_INFO[p.currentTask.task].name} in ${ROOM_NAMES[p.currentTask.room]}.`, "task");
        p.currentTask = null;
      }
      return;
    }
    // Report body
    for (const q of this.players) {
      if (!q.alive && q.room === p.room && !q.reported) {
        q.reported = true;
        this._log(`${p.name} found ${q.name}'s body in ${ROOM_NAMES[q.room]}!`, "report");
        this._callMeeting(p, "body", q);
        return;
      }
    }
    // Emergency meeting (from cafeteria)
    if (p.emergencyCooldown > 0) p.emergencyCooldown--;
    else if (p.room === "cafeteria" && Math.random() < 0.04) {
      p.emergencyCooldown = ri(50, 80);
      this._log(`${p.name} called an Emergency Meeting!`, "meeting");
      this._callMeeting(p, "emergency");
      return;
    }
    // Do next task
    const pending = p.tasks.filter(t => !t.done);
    if (!pending.length) { this._wander(p); return; }
    const next = pending[0];
    if (p.room === next.room) {
      p.currentTask = next;
      p.taskTimer   = TASK_INFO[next.task].dur;
      this._log(`${p.name} started ${TASK_INFO[next.task].name} in ${ROOM_NAMES[p.room]}.`, "info");
    } else {
      this._moveTo(p, next.room);
    }
  }

  // ── Impostor AI ───────────────────────────────────────────────────────────────────

  _impAI(p) {
    p.killCooldown     = Math.max(0, p.killCooldown - 1);
    p.sabotageCooldown = Math.max(0, p.sabotageCooldown - 1);

    // Sabotage
    if (!this.sabotage && p.sabotageCooldown === 0 && Math.random() < 0.11) {
      this._sabotage(p); return;
    }
    // Kill
    if (p.killCooldown === 0) {
      const others = this.players.filter(q => q.alive && q.id !== p.id && q.room === p.room);
      const crew   = others.filter(q => q.role === "crewmate");
      const imps   = others.filter(q => q.role === "impostor");
      if (crew.length && !imps.length && others.length <= 2) {
        this._kill(p, crew[Math.floor(Math.random() * crew.length)]); return;
      }
    }
    // Hunt
    const byRoom = {};
    for (const q of this.players)
      if (q.alive) (byRoom[q.room] = byRoom[q.room] || []).push(q);

    let target = null;
    for (const [room, occ] of Object.entries(byRoom)) {
      const c = occ.filter(q => q.role === "crewmate");
      const i = occ.filter(q => q.role === "impostor");
      if (c.length === 1 && !i.length && room !== p.room) { target = room; break; }
    }
    if (!target) {
      const alive = this.players.filter(q => q.alive && q.role === "crewmate");
      if (alive.length) target = alive[Math.floor(Math.random() * alive.length)].room;
    }
    if (target && p.room !== target) {
      if (VENT_CONN[p.room] && Math.random() < 0.20) {
        const opts = VENT_CONN[p.room];
        const old  = p.room;
        p.room = opts[Math.floor(Math.random() * opts.length)];
        this._log(`${p.name} used a vent from ${ROOM_NAMES[old]}.`, "vent");
      } else this._moveTo(p, target);
    } else this._wander(p);
  }

  // ── Actions ────────────────────────────────────────────────────────────────────

  _kill(killer, victim) {
    victim.alive = false; victim.reported = false;
    killer.killCooldown = 14;
    this.totalKills++;
    this._log(`${killer.name} eliminated ${victim.name} in ${ROOM_NAMES[victim.room]}!`, "kill");
    // Direct witnesses (same room, survived) get high suspicion; others get a smaller trace
    const adj = new Set([victim.room, ...(SKELD_CONNECTIONS[victim.room]||[])]);
    for (const p of this.players) {
      if (!p.alive || p.role !== "crewmate") continue;
      if (p.room === victim.room) this.suspicion[killer.id] = (this.suspicion[killer.id]||0) + 5;
      else if (adj.has(p.room) && Math.random() < 0.40)
        this.suspicion[killer.id] = (this.suspicion[killer.id]||0) + 1;
    }
  }

  _sabotage(p) {
    const types = Object.keys(SABOTAGES);
    const type  = types[Math.floor(Math.random() * types.length)];
    const info  = SABOTAGES[type];
    this.sabotage = {type, fixers: new Set(), by: p.id};
    if (info.dur) this.sabotageTimer = info.dur;
    p.sabotageCooldown = 30;
    this._log(`${p.name} triggered ${info.name}!`, "sabotage");
  }

  // ── Meeting ─────────────────────────────────────────────────────────────────────

  _callMeeting(caller, type, body = null) {
    this.phase = "meeting";
    this.meetingCaller = caller; this.meetingType = type; this.meetingBody = body;
    this.meetingTimer = 22; this.meetingsHeld++;
    this.votes = {}; this.sabotage = null;
    for (const p of this.players) if (p.alive) p.voteDelay = ri(1, 6);
    const lbl = type === "body" ? "BODY REPORTED" : "EMERGENCY MEETING";
    this._log(`=== ${lbl} – Called by ${caller.name} ===`, "meeting");
  }

  _meetingTick() {
    for (const p of this.players)
      if (p.alive && !(p.id in this.votes)) { p.voteDelay--; if (p.voteDelay <= 0) this._vote(p); }
    this.meetingTimer--;
    const allIn = this.players.filter(p => p.alive).every(p => p.id in this.votes);
    if (this.meetingTimer <= 0 || allIn) this._resolve();
  }

  _vote(p) {
    const others = this.players.filter(q => q.alive && q.id !== p.id);
    if (p.role === "impostor") {
      const crew = others.filter(q => q.role === "crewmate");
      if (crew.length && Math.random() < 0.65) {
        const t = crew[Math.floor(Math.random() * crew.length)];
        this.votes[p.id] = t.id;
        this._log(`${p.name} voted for ${t.name}.`, "vote");
      } else { this.votes[p.id] = "skip"; this._log(`${p.name} skipped.`, "vote"); }
    } else {
      const suspects = Object.entries(this.suspicion)
        .filter(([id]) => others.some(q => q.id === +id))
        .sort((a,b) => b[1]-a[1]);
      if (suspects.length && Math.random() < 0.48) {
        const t = others.find(q => q.id === +suspects[0][0]);
        this.votes[p.id] = t.id;
        this._log(`${p.name} is suspicious of ${t.name}!`, "vote");
      } else if (others.length && Math.random() < 0.58) {
        const t = others[Math.floor(Math.random() * others.length)];
        this.votes[p.id] = t.id;
        this._log(`${p.name} voted for ${t.name}.`, "vote");
      } else { this.votes[p.id] = "skip"; this._log(`${p.name} skipped.`, "vote"); }
    }
  }

  _resolve() {
    const counts = {};
    for (const v of Object.values(this.votes))
      if (v && v !== "skip") counts[v] = (counts[v]||0) + 1;
    if (!Object.keys(counts).length) {
      this._log("No majority – nobody ejected.", "meeting");
    } else {
      const maxV = Math.max(...Object.values(counts));
      const top  = Object.keys(counts).filter(k => counts[k] === maxV);
      if (top.length > 1) {
        this._log("Tied vote – nobody ejected.", "meeting");
      } else {
        const ej = this.players.find(p => p.id === +top[0]);
        ej.alive = false;
        this._log(`${ej.name} was ejected. ${ej.name} ${ej.role === "impostor" ? "WAS an Impostor" : "was NOT an Impostor"}!`, "eject");
      }
    }
    this.phase = "game"; this.suspicion = {};
    for (const p of this.players) if (p.role === "impostor" && p.alive) p.killCooldown = 10;
  }

  // ── Win check ───────────────────────────────────────────────────────────────────

  _checkWin() {
    if (this.phase === "ended") return;
    const imp  = this.players.filter(p => p.alive && p.role === "impostor");
    const crew = this.players.filter(p => p.alive && p.role === "crewmate");
    if (!imp.length) {
      this.phase = "ended"; this.winner = "crewmates";
      this._log("=== CREWMATES WIN – All impostors eliminated! ===", "win");
      this.stop(); return;
    }
    if (imp.length >= crew.length) {
      this.phase = "ended"; this.winner = "impostors";
      this._log("=== IMPOSTORS WIN – They outnumber the crew! ===", "win");
      this.stop(); return;
    }
    const allCrew = this.players.filter(p => p.role === "crewmate");
    const tot = allCrew.reduce((s,p) => s + p.tasks.length, 0);
    const don = allCrew.reduce((s,p) => s + p.tasks.filter(t=>t.done).length, 0);
    if (tot > 0 && don >= tot) {
      this.phase = "ended"; this.winner = "crewmates";
      this._log("=== CREWMATES WIN – All tasks completed! ===", "win");
      this.stop();
    }
  }

  // ── Movement ───────────────────────────────────────────────────────────────────

  _bfs(start, end) {
    if (start === end) return [start];
    const q = [[start]], vis = new Set([start]);
    while (q.length) {
      const path = q.shift(), node = path[path.length-1];
      for (const nb of (SKELD_CONNECTIONS[node]||[])) {
        if (nb === end) return [...path, nb];
        if (!vis.has(nb)) { vis.add(nb); q.push([...path, nb]); }
      }
    }
    return [start];
  }

  _moveTo(p, target) {
    const path = this._bfs(p.room, target);
    if (path.length > 1) p.room = path[1];
  }

  _wander(p) {
    if (Math.random() < 0.35) {
      const nbs = SKELD_CONNECTIONS[p.room]||[];
      if (nbs.length) p.room = nbs[Math.floor(Math.random() * nbs.length)];
    }
  }

  // ── State / logging ──────────────────────────────────────────────────────────────────

  _log(msg, tag="info") {
    this.events.push({tick:this.tick, msg, tag});
    if (this.events.length > 120) this.events.shift();
  }

  state() {
    const crew = this.players.filter(p => p.role === "crewmate");
    const tot  = crew.reduce((s,p) => s + p.tasks.length, 0);
    const don  = crew.reduce((s,p) => s + p.tasks.filter(t=>t.done).length, 0);
    return {
      phase:        this.phase,
      tick:         this.tick,
      winner:       this.winner,
      task_progress:tot > 0 ? Math.round(don/tot*1000)/10 : 0,
      sabotage:     this.sabotage ? {
        type:this.sabotage.type, name:SABOTAGES[this.sabotage.type].name,
        timer:this.sabotageTimer,
        fixers:this.sabotage.fixers.size, fixers_needed:SABOTAGES[this.sabotage.type].need,
        critical:SABOTAGES[this.sabotage.type].game_over,
      } : null,
      players:        this.players.map(p => p.snap()),
      events:         this.events.slice(-30),
      votes:          {...this.votes},
      meeting_timer:  this.meetingTimer,
      meeting_type:   this.meetingType,
      meeting_body:   this.meetingBody ? {name:this.meetingBody.name, room:this.meetingBody.room} : null,
      meeting_caller: this.meetingCaller ? this.meetingCaller.name : null,
      meetings_held:  this.meetingsHeld,
      total_kills:    this.totalKills,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

function ri(a, b) { return Math.floor(Math.random() * (b-a+1)) + a; }
function shuffle(a) {
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ═════════════════════════════════════════════════════════════════════════
// MAP GEOMETRY (The Skeld – reference canvas 940×640)
// ═════════════════════════════════════════════════════════════════════════

const REF_W = 940, REF_H = 640;

const ROOMS_GFX = {
  upper_engine:   {x:30,  y:42,  w:165,h:110, label:"Upper\nEngine",  color:"#1e2e3e"},
  cafeteria:      {x:268, y:28,  w:215,h:155, label:"Cafeteria",      color:"#2a2a1e"},
  weapons:        {x:567, y:28,  w:175,h:135, label:"Weapons",        color:"#1e2e3e"},
  reactor:        {x:22,  y:222, w:175,h:150, label:"Reactor",        color:"#2e1e1e"},
  security:       {x:204, y:258, w:155,h:115, label:"Security",       color:"#1e1e2e"},
  medbay:         {x:262, y:175, w:148,h:110, label:"MedBay",         color:"#1e2e22"},
  o2:             {x:524, y:173, w:133,h:110, label:"O2",             color:"#1e2a1e"},
  navigation:     {x:742, y:200, w:160,h:128, label:"Navigation",     color:"#1e2e3e"},
  lower_engine:   {x:22,  y:450, w:170,h:128, label:"Lower\nEngine",  color:"#1e2e3e"},
  electrical:     {x:218, y:400, w:155,h:118, label:"Electrical",     color:"#2e2a10"},
  admin:          {x:478, y:336, w:160,h:140, label:"Admin",          color:"#1e1e2e"},
  shields:        {x:668, y:358, w:165,h:128, label:"Shields",        color:"#1a2a2a"},
  storage:        {x:356, y:452, w:172,h:124, label:"Storage",        color:"#222010"},
  communications: {x:577, y:488, w:175,h:110, label:"Comms",          color:"#10222a"},
};

const CORRIDORS_GFX = [
  ["upper_engine","cafeteria"], ["upper_engine","reactor"],  ["upper_engine","security"],
  ["cafeteria","weapons"],      ["cafeteria","medbay"],
  ["weapons","navigation"],     ["weapons","o2"],
  ["reactor","security"],       ["reactor","lower_engine"],
  ["security","electrical"],    ["security","medbay"],
  ["medbay","admin"],
  ["o2","admin"],               ["o2","shields"],
  ["navigation","shields"],
  ["lower_engine","electrical"],["lower_engine","storage"],
  ["electrical","storage"],
  ["admin","shields"],          ["admin","storage"],
  ["shields","communications"],
  ["storage","communications"],
];

const VENT_ROOMS_GFX = new Set([
  "security","cafeteria","medbay",
  "reactor","upper_engine","electrical",
  "lower_engine","storage","admin",
]);

const TASK_DOTS_GFX = {
  cafeteria:      [{fx:0.25,fy:0.6},{fx:0.7,fy:0.4}],
  weapons:        [{fx:0.5,fy:0.5}],
  navigation:     [{fx:0.4,fy:0.5},{fx:0.75,fy:0.5}],
  o2:             [{fx:0.5,fy:0.5}],
  shields:        [{fx:0.5,fy:0.55}],
  communications: [{fx:0.5,fy:0.5}],
  storage:        [{fx:0.4,fy:0.5},{fx:0.7,fy:0.5}],
  admin:          [{fx:0.5,fy:0.45}],
  electrical:     [{fx:0.4,fy:0.5},{fx:0.7,fy:0.6}],
  lower_engine:   [{fx:0.5,fy:0.55}],
  security:       [{fx:0.5,fy:0.5}],
  reactor:        [{fx:0.4,fy:0.5},{fx:0.7,fy:0.5}],
  upper_engine:   [{fx:0.5,fy:0.55}],
  medbay:         [{fx:0.45,fy:0.5},{fx:0.75,fy:0.5}],
};

function gCenter(key) {
  const r = ROOMS_GFX[key];
  return {x: r.x + r.w/2, y: r.y + r.h/2};
}

// ═════════════════════════════════════════════════════════════════════════
// CANVAS RENDERING
// ═════════════════════════════════════════════════════════════════════════

const canvas = document.getElementById("map-canvas");
const ctx    = canvas.getContext("2d");
let scale    = 1;

function resizeCanvas() {
  const wrap = document.getElementById("map-wrap");
  const aw = wrap.clientWidth - 20, ah = wrap.clientHeight - 20;
  scale = Math.min(aw/REF_W, ah/REF_H, 1.3);
  canvas.width  = REF_W * scale;
  canvas.height = REF_H * scale;
  if (lastState) renderMap(lastState);
}
window.addEventListener("resize", resizeCanvas);

function renderMap(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  drawCorridors();
  drawRooms();
  drawVents();
  drawTaskDots();
  drawPlayers(state);
  ctx.restore();
}

function drawCorridors() {
  ctx.lineWidth = 26; ctx.strokeStyle = "#161628"; ctx.lineCap = "round";
  for (const [a,b] of CORRIDORS_GFX) {
    const ca = gCenter(a), cb = gCenter(b);
    ctx.beginPath(); ctx.moveTo(ca.x,ca.y); ctx.lineTo(cb.x,cb.y); ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawRooms() {
  for (const [key, r] of Object.entries(ROOMS_GFX)) {
    rrect(ctx, r.x, r.y, r.w, r.h, 8);
    ctx.fillStyle = r.color; ctx.fill();
    ctx.strokeStyle = "#3a3a6a"; ctx.lineWidth = 1.5;
    rrect(ctx, r.x, r.y, r.w, r.h, 8); ctx.stroke();

    const lines = r.label.split("\n");
    ctx.fillStyle = "#8899cc"; ctx.font = "bold 10px 'Segoe UI',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const cy = r.y + r.h/2;
    if (lines.length === 1) ctx.fillText(lines[0], r.x+r.w/2, cy);
    else { ctx.fillText(lines[0], r.x+r.w/2, cy-6); ctx.fillText(lines[1], r.x+r.w/2, cy+6); }
  }
}

function drawVents() {
  for (const key of VENT_ROOMS_GFX) {
    const r = ROOMS_GFX[key];
    const vx = r.x + r.w - 14, vy = r.y + 10, sz = 5;
    ctx.fillStyle = "#44aa66";
    ctx.beginPath();
    ctx.moveTo(vx,vy-sz); ctx.lineTo(vx+sz,vy); ctx.lineTo(vx,vy+sz); ctx.lineTo(vx-sz,vy);
    ctx.closePath(); ctx.fill();
  }
}

function drawTaskDots() {
  for (const [key, dots] of Object.entries(TASK_DOTS_GFX)) {
    const r = ROOMS_GFX[key];
    for (const d of dots) {
      ctx.fillStyle = "rgba(255,238,68,0.35)";
      ctx.beginPath();
      ctx.arc(r.x + r.w*d.fx, r.y + r.h*d.fy, 4, 0, Math.PI*2);
      ctx.fill();
    }
  }
}

function drawPlayers(state) {
  if (!state || !state.players) return;
  const byRoom = {};
  for (const p of state.players) (byRoom[p.room] = byRoom[p.room]||[]).push(p);

  for (const [rKey, players] of Object.entries(byRoom)) {
    const r = ROOMS_GFX[rKey]; if (!r) continue;
    const n = players.length, cx = r.x+r.w/2, cy = r.y+r.h/2+8;
    const spread = Math.min(18, (r.w-20)/(n+1));

    players.forEach((p, i) => {
      const px = cx + (i - (n-1)/2) * spread, py = cy;
      if (!p.alive) ctx.globalAlpha = 0.35;

      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(px, py, p.alive ? 9 : 7, 0, Math.PI*2); ctx.fill();

      if (p.alive) {
        ctx.fillStyle = "rgba(150,220,255,0.6)";
        ctx.beginPath(); ctx.ellipse(px+2, py-3, 4, 3, 0.3, 0, Math.PI*2); ctx.fill();

        if (p.role === "crewmate" && p.tasks_total > 0) {
          const pct = p.tasks_done / p.tasks_total;
          ctx.strokeStyle = "#50ef39"; ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 11, -Math.PI/2, -Math.PI/2 + pct*Math.PI*2);
          ctx.stroke();
        }
      } else {
        ctx.strokeStyle = "#ff4444"; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px-4,py-4); ctx.lineTo(px+4,py+4);
        ctx.moveTo(px+4,py-4); ctx.lineTo(px-4,py+4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      ctx.fillStyle = p.alive ? "#ddeeff" : "#664444";
      ctx.font = "7px 'Segoe UI',sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(p.name, px, py+11);
    });
  }
}

function rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

// ═════════════════════════════════════════════════════════════════════════
// UI UPDATES
// ═════════════════════════════════════════════════════════════════════════

let lastState     = null;
let lastPhase     = null;
let lastLogLen    = 0;
const MTX_TICKS   = 22;

function applyState(state) {
  lastState = state;

  document.getElementById("tick-counter").textContent = "Tick " + state.tick;
  document.getElementById("task-bar-fill").style.width = state.task_progress + "%";
  document.getElementById("task-pct").textContent      = state.task_progress + "%";

  const sabEl = document.getElementById("sabotage-alert");
  if (state.sabotage) {
    sabEl.classList.remove("hidden");
    const t = state.sabotage.critical && state.sabotage.timer ? ` (${state.sabotage.timer}s)` : "";
    sabEl.textContent = "⚠ " + state.sabotage.name + t;
  } else sabEl.classList.add("hidden");

  updatePlayerList(state);
  updateEventLog(state);

  if (state.phase === "meeting") showMeeting(state);
  else document.getElementById("meeting-overlay").classList.add("hidden");

  if (state.phase === "ended" && lastPhase !== "ended") showGameOver(state);

  lastPhase = state.phase;
  renderMap(state);
}

function updatePlayerList(state) {
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  for (const p of state.players) {
    const el = document.createElement("div");
    el.className = "player-entry" + (p.alive ? "" : " dead");

    const dot = document.createElement("div");
    dot.className = "player-dot"; dot.style.background = p.color;

    const name = document.createElement("div");
    name.className = "player-name"; name.textContent = p.name;

    const role = document.createElement("div");
    role.className = "player-role " + p.role;
    role.textContent = p.role === "impostor" ? "IMPOSTOR" : "CREW";

    const room = document.createElement("div");
    room.className = "player-room-mini";
    room.textContent = ROOM_NAMES[p.room] || p.room;

    el.appendChild(dot); el.appendChild(name); el.appendChild(role); el.appendChild(room);

    if (p.alive && p.role === "crewmate" && p.tasks_total > 0) {
      const tasks = document.createElement("div");
      tasks.className = "player-task-mini";
      tasks.textContent = p.tasks_done + "/" + p.tasks_total;
      el.appendChild(tasks);
    }
    list.appendChild(el);
  }
}

function updateEventLog(state) {
  const events = state.events || [];
  if (events.length === lastLogLen) return;
  lastLogLen = events.length;
  const log = document.getElementById("event-log");
  log.innerHTML = "";
  for (const ev of events) {
    const el = document.createElement("div");
    el.className = "log-entry " + (ev.tag || "info");
    el.textContent = "[" + String(ev.tick).padStart(3,"0") + "] " + ev.msg;
    log.appendChild(el);
  }
  log.scrollTop = log.scrollHeight;
}

function showMeeting(state) {
  document.getElementById("meeting-overlay").classList.remove("hidden");

  const isBody = state.meeting_type === "body";
  document.getElementById("meeting-title").textContent = isBody ? "BODY REPORTED" : "EMERGENCY MEETING";

  let sub = "";
  if (isBody && state.meeting_body)
    sub = `${state.meeting_body.name}'s body in ${ROOM_NAMES[state.meeting_body.room] || state.meeting_body.room}` +
          (state.meeting_caller ? ` (reported by ${state.meeting_caller})` : "");
  else if (state.meeting_caller) sub = `Called by ${state.meeting_caller}`;
  document.getElementById("meeting-sub").textContent = sub;

  const pct = Math.max(0, state.meeting_timer / MTX_TICKS * 100);
  document.getElementById("meeting-timer-bar").style.width = pct + "%";
  document.getElementById("meeting-timer-txt").textContent = Math.max(0, state.meeting_timer) + "s";

  const grid = document.getElementById("meeting-players");
  grid.innerHTML = "";
  for (const p of state.players) {
    const el  = document.createElement("div");
    el.className = "meeting-player" + (p.alive ? "" : " dead");

    const dot = document.createElement("div");
    dot.className = "meeting-dot"; dot.style.background = p.color;

    const info = document.createElement("div");
    info.style.flex = "1";

    const nm = document.createElement("div");
    nm.style.fontWeight = "600"; nm.textContent = p.name;

    const vi = document.createElement("div");
    vi.className = "meeting-vote-info";
    const vid = state.votes[String(p.id)];
    if (!p.alive) vi.textContent = "☠ Dead";
    else if (vid === undefined) vi.textContent = "Thinking…";
    else if (vid === "skip") vi.textContent = "⟳ Skip";
    else {
      const tgt = state.players.find(x => x.id === vid);
      vi.textContent = tgt ? "→ " + tgt.name : "→ ?";
      el.classList.add("voted");
    }
    info.appendChild(nm); info.appendChild(vi);
    el.appendChild(dot); el.appendChild(info);
    grid.appendChild(el);
  }
}

function showGameOver(state) {
  const overlay = document.getElementById("gameover-overlay");
  overlay.classList.remove("hidden");
  const crewWin = state.winner === "crewmates";
  const box = document.getElementById("gameover-box");
  box.style.borderColor = crewWin ? "#132ed1" : "#c51111";
  box.style.color       = crewWin ? "#aaccff" : "#ffaaaa";
  box.style.boxShadow   = crewWin ? "0 0 80px rgba(19,46,209,0.4)" : "0 0 80px rgba(197,17,17,0.4)";
  document.getElementById("gameover-title").textContent = crewWin ? "CREWMATES WIN" : "IMPOSTORS WIN";
  document.getElementById("gameover-sub").textContent   = crewWin
    ? "The crew successfully completed their mission!"
    : "The impostors have taken control of the ship!";
  const gop = document.getElementById("gameover-players");
  gop.innerHTML = "";
  for (const p of state.players) {
    const el = document.createElement("div");
    el.className = "go-player" + (p.role === "impostor" ? " impostor" : "") + (p.alive ? "" : " dead");
    const dot = document.createElement("div");
    dot.className = "go-dot"; dot.style.background = p.color;
    const lbl = document.createElement("span");
    lbl.textContent = p.name + (p.role === "impostor" ? " 🔪" : "");
    el.appendChild(dot); el.appendChild(lbl);
    gop.appendChild(el);
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SETTINGS & MENU
// ═════════════════════════════════════════════════════════════════════════

const cfg = {players:10, impostors:2, speed:"normal"};
const gameEngine = new Game();

function adjustSetting(key, delta) {
  if (key === "players") {
    cfg.players   = Math.max(4, Math.min(12, cfg.players + delta));
    cfg.impostors = Math.min(cfg.impostors, Math.floor(cfg.players/2));
    document.getElementById("val-players").textContent   = cfg.players;
    document.getElementById("val-impostors").textContent = cfg.impostors;
  } else {
    cfg.impostors = Math.max(1, Math.min(3, Math.min(cfg.impostors+delta, Math.floor(cfg.players/2))));
    document.getElementById("val-impostors").textContent = cfg.impostors;
  }
}

function setSpeed(s) {
  cfg.speed = s;
  document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("spd-" + s).classList.add("selected");
}

function startGame() {
  const ms = {slow:2500, normal:1500, fast:700}[cfg.speed] || 1500;
  gameEngine.configure(cfg.players, cfg.impostors, ms);
  gameEngine.onChange = applyState;
  gameEngine.start();
  lastLogLen = 0; lastState = null; lastPhase = null;
  document.getElementById("menu-screen").classList.remove("active");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("meeting-overlay").classList.add("hidden");
  document.getElementById("game-screen").classList.add("active");
  resizeCanvas();
}

function goToMenu() {
  gameEngine.stop();
  document.getElementById("game-screen").classList.remove("active");
  document.getElementById("meeting-overlay").classList.add("hidden");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("menu-screen").classList.add("active");
  lastState = null; lastPhase = null; lastLogLen = 0;
}

// ── Boot ────────────────────────────────────────────────────────────────────────
window.addEventListener("load", () => {
  resizeCanvas();
  renderMap(null);
});
