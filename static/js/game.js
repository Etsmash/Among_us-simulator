// ── Settings state ─────────────────────────────────────────────────────────
const settings = { players: 10, impostors: 2, speed: "normal" };
const PLAYER_MIN = 4, PLAYER_MAX = 12;
const IMP_MIN    = 1, IMP_MAX    = 3;

function adjustSetting(key, delta) {
  if (key === "players") {
    settings.players = Math.max(PLAYER_MIN, Math.min(PLAYER_MAX, settings.players + delta));
    settings.impostors = Math.min(settings.impostors, Math.floor(settings.players / 2));
    document.getElementById("val-players").textContent  = settings.players;
    document.getElementById("val-impostors").textContent = settings.impostors;
  } else {
    settings.impostors = Math.max(IMP_MIN, Math.min(IMP_MAX, Math.min(settings.impostors + delta, Math.floor(settings.players / 2))));
    document.getElementById("val-impostors").textContent = settings.impostors;
  }
}

function setSpeed(s) {
  settings.speed = s;
  document.querySelectorAll(".speed-btn").forEach(b => b.classList.remove("selected"));
  document.getElementById("spd-" + s).classList.add("selected");
}

function startGame() {
  fetch("/api/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ num_players: settings.players, num_impostors: settings.impostors, speed: settings.speed }),
  });
  document.getElementById("menu-screen").classList.remove("active");
  document.getElementById("game-screen").classList.add("active");
  resizeCanvas();
}

function goToMenu() {
  fetch("/api/stop", { method: "POST" });
  document.getElementById("game-screen").classList.remove("active");
  document.getElementById("meeting-overlay").classList.add("hidden");
  document.getElementById("gameover-overlay").classList.add("hidden");
  document.getElementById("menu-screen").classList.add("active");
}

// ── Map geometry ───────────────────────────────────────────────────────────
// Coordinates are for a reference canvas of 940×640
const REF_W = 940, REF_H = 640;

const ROOMS = {
  upper_engine:   { x: 30,  y: 42,  w: 165, h: 110, label: "Upper\nEngine",  color: "#1e2e3e" },
  cafeteria:      { x: 268, y: 28,  w: 215, h: 155, label: "Cafeteria",      color: "#2a2a1e" },
  weapons:        { x: 567, y: 28,  w: 175, h: 135, label: "Weapons",        color: "#1e2e3e" },
  reactor:        { x: 22,  y: 222, w: 175, h: 150, label: "Reactor",        color: "#2e1e1e" },
  security:       { x: 204, y: 258, w: 155, h: 115, label: "Security",       color: "#1e1e2e" },
  medbay:         { x: 262, y: 175, w: 148, h: 110, label: "MedBay",         color: "#1e2e22" },
  o2:             { x: 524, y: 173, w: 133, h: 110, label: "O2",             color: "#1e2a1e" },
  navigation:     { x: 742, y: 200, w: 160, h: 128, label: "Navigation",     color: "#1e2e3e" },
  lower_engine:   { x: 22,  y: 450, w: 170, h: 128, label: "Lower\nEngine",  color: "#1e2e3e" },
  electrical:     { x: 218, y: 400, w: 155, h: 118, label: "Electrical",     color: "#2e2a10" },
  admin:          { x: 478, y: 336, w: 160, h: 140, label: "Admin",          color: "#1e1e2e" },
  shields:        { x: 668, y: 358, w: 165, h: 128, label: "Shields",        color: "#1a2a2a" },
  storage:        { x: 356, y: 452, w: 172, h: 124, label: "Storage",        color: "#222010" },
  communications: { x: 577, y: 488, w: 175, h: 110, label: "Comms",          color: "#10222a" },
};

// center point of each room
function roomCenter(key) {
  const r = ROOMS[key];
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

const CORRIDORS = [
  ["upper_engine","cafeteria"], ["upper_engine","reactor"], ["upper_engine","security"],
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

// Which rooms have vents
const VENT_ROOMS = new Set([
  "security","cafeteria","medbay",
  "reactor","upper_engine","electrical",
  "lower_engine","storage","admin",
]);

// Task dot locations (offset within room so they're visible)
const TASK_DOTS = {
  cafeteria:      [{dx:0.25,dy:0.6},{dx:0.7,dy:0.4}],
  weapons:        [{dx:0.5,dy:0.5}],
  navigation:     [{dx:0.4,dy:0.5},{dx:0.75,dy:0.5}],
  o2:             [{dx:0.5,dy:0.5}],
  shields:        [{dx:0.5,dy:0.55}],
  communications: [{dx:0.5,dy:0.5}],
  storage:        [{dx:0.4,dy:0.5},{dx:0.7,dy:0.5}],
  admin:          [{dx:0.5,dy:0.45}],
  electrical:     [{dx:0.4,dy:0.5},{dx:0.7,dy:0.6}],
  lower_engine:   [{dx:0.5,dy:0.55}],
  security:       [{dx:0.5,dy:0.5}],
  reactor:        [{dx:0.4,dy:0.5},{dx:0.7,dy:0.5}],
  upper_engine:   [{dx:0.5,dy:0.55}],
  medbay:         [{dx:0.45,dy:0.5},{dx:0.75,dy:0.5}],
};

// ── Canvas setup ───────────────────────────────────────────────────────────
const canvas = document.getElementById("map-canvas");
const ctx    = canvas.getContext("2d");
let scale = 1;

function resizeCanvas() {
  const wrap = document.getElementById("map-wrap");
  const availW = wrap.clientWidth  - 20;
  const availH = wrap.clientHeight - 20;
  scale = Math.min(availW / REF_W, availH / REF_H, 1.3);
  canvas.width  = REF_W * scale;
  canvas.height = REF_H * scale;
  if (lastState) renderMap(lastState);
}
window.addEventListener("resize", resizeCanvas);

// ── Map rendering ──────────────────────────────────────────────────────────
function renderMap(state) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);

  drawCorridors();
  drawRooms(state);
  drawVents();
  drawTaskDots(state);
  drawPlayers(state);

  ctx.restore();
}

function drawCorridors() {
  ctx.lineWidth   = 26;
  ctx.strokeStyle = "#161628";
  ctx.lineCap     = "round";
  for (const [a, b] of CORRIDORS) {
    const ca = roomCenter(a), cb = roomCenter(b);
    ctx.beginPath();
    ctx.moveTo(ca.x, ca.y);
    ctx.lineTo(cb.x, cb.y);
    ctx.stroke();
  }
  ctx.lineWidth = 1;
}

function drawRooms(state) {
  const phase = state ? state.phase : "lobby";
  for (const [key, r] of Object.entries(ROOMS)) {
    const radius = 8;
    // Fill
    ctx.fillStyle = r.color;
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.fill();
    // Border
    ctx.strokeStyle = "#3a3a6a";
    ctx.lineWidth   = 1.5;
    roundRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.stroke();

    // Room label
    const lines = r.label.split("\n");
    ctx.fillStyle   = "#8899cc";
    ctx.font        = `bold ${10}px 'Segoe UI', sans-serif`;
    ctx.textAlign   = "center";
    ctx.textBaseline = "middle";
    const cy = r.y + r.h / 2;
    if (lines.length === 1) {
      ctx.fillText(lines[0], r.x + r.w / 2, cy);
    } else {
      ctx.fillText(lines[0], r.x + r.w / 2, cy - 6);
      ctx.fillText(lines[1], r.x + r.w / 2, cy + 6);
    }
  }
}

function drawVents() {
  for (const key of VENT_ROOMS) {
    const r   = ROOMS[key];
    const vx  = r.x + r.w - 14;
    const vy  = r.y + 10;
    const sz  = 5;
    ctx.fillStyle = "#44aa66";
    ctx.beginPath();
    ctx.moveTo(vx,    vy - sz);
    ctx.lineTo(vx+sz, vy);
    ctx.lineTo(vx,    vy + sz);
    ctx.lineTo(vx-sz, vy);
    ctx.closePath();
    ctx.fill();
  }
}

function drawTaskDots(state) {
  if (!state) return;
  for (const [key, dots] of Object.entries(TASK_DOTS)) {
    const r = ROOMS[key];
    for (const d of dots) {
      const dx = r.x + r.w * d.dx;
      const dy = r.y + r.h * d.dy;
      ctx.fillStyle = "rgba(255,238,68,0.35)";
      ctx.beginPath();
      ctx.arc(dx, dy, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayers(state) {
  if (!state || !state.players) return;

  // Group players by room
  const byRoom = {};
  for (const p of state.players) {
    if (!byRoom[p.room]) byRoom[p.room] = [];
    byRoom[p.room].push(p);
  }

  for (const [roomKey, players] of Object.entries(byRoom)) {
    const r    = ROOMS[roomKey];
    if (!r) continue;
    const n    = players.length;
    const cx   = r.x + r.w / 2;
    const cy   = r.y + r.h / 2 + 8;
    const spread = Math.min(18, (r.w - 20) / (n + 1));

    players.forEach((p, i) => {
      const px = cx + (i - (n - 1) / 2) * spread;
      const py = cy;
      const alive = p.alive;

      // Shadow / glow for impostor
      if (!alive) {
        ctx.globalAlpha = 0.35;
      }

      // Body circle
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, alive ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();

      if (alive) {
        // Visor
        ctx.fillStyle = "rgba(150,220,255,0.6)";
        ctx.beginPath();
        ctx.ellipse(px + 2, py - 3, 4, 3, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Task progress ring for crewmates
        if (p.role === "crewmate" && p.tasks_total > 0) {
          const pct = p.tasks_done / p.tasks_total;
          ctx.strokeStyle = "#50ef39";
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.arc(px, py, 11, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // Dead X
        ctx.strokeStyle = "#ff4444";
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
        ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Name tag (tiny)
      ctx.fillStyle    = alive ? "#ddeeff" : "#664444";
      ctx.font         = `${7}px 'Segoe UI', sans-serif`;
      ctx.textAlign    = "center";
      ctx.textBaseline = "top";
      ctx.fillText(p.name, px, py + 11);
    });
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── UI updates ─────────────────────────────────────────────────────────────
let lastState       = null;
let lastPhase       = null;
let lastLogLength   = 0;
const MEETING_TICKS = 22;

function applyState(state) {
  lastState = state;

  // Tick counter
  document.getElementById("tick-counter").textContent = "Tick " + state.tick;

  // Task bar
  document.getElementById("task-bar-fill").style.width = state.task_progress + "%";
  document.getElementById("task-pct").textContent       = state.task_progress + "%";

  // Sabotage alert
  const sabEl = document.getElementById("sabotage-alert");
  if (state.sabotage) {
    sabEl.classList.remove("hidden");
    const timer = state.sabotage.critical && state.sabotage.timer
      ? " (" + state.sabotage.timer + "s)" : "";
    sabEl.textContent = "⚠ " + state.sabotage.name + timer;
  } else {
    sabEl.classList.add("hidden");
  }

  // Player list
  updatePlayerList(state);

  // Event log
  updateEventLog(state);

  // Meeting overlay
  if (state.phase === "meeting") {
    showMeeting(state);
  } else {
    document.getElementById("meeting-overlay").classList.add("hidden");
  }

  // Game over
  if (state.phase === "ended" && lastPhase !== "ended") {
    showGameOver(state);
  }

  lastPhase = state.phase;

  // Render map
  renderMap(state);
}

function updatePlayerList(state) {
  const list = document.getElementById("player-list");
  list.innerHTML = "";
  for (const p of state.players) {
    const el    = document.createElement("div");
    el.className = "player-entry" + (p.alive ? "" : " dead");

    const dot  = document.createElement("div");
    dot.className = "player-dot";
    dot.style.background = p.color;

    const name = document.createElement("div");
    name.className = "player-name";
    name.textContent = p.name;

    const role = document.createElement("div");
    role.className   = "player-role " + p.role;
    role.textContent = p.role === "impostor" ? "IMPOSTOR" : "CREW";

    const room = document.createElement("div");
    room.className   = "player-room-mini";
    room.textContent = ROOM_LABELS[p.room] || p.room;

    el.appendChild(dot);
    el.appendChild(name);
    el.appendChild(role);
    el.appendChild(room);

    if (p.alive && p.role === "crewmate" && p.tasks_total > 0) {
      const tasks = document.createElement("div");
      tasks.className   = "player-task-mini";
      tasks.textContent = p.tasks_done + "/" + p.tasks_total;
      el.appendChild(tasks);
    }

    list.appendChild(el);
  }
}

const ROOM_LABELS = {
  cafeteria:"Cafeteria", weapons:"Weapons", navigation:"Navigation",
  o2:"O2", shields:"Shields", communications:"Comms", storage:"Storage",
  admin:"Admin", electrical:"Electrical", lower_engine:"Lower Engine",
  security:"Security", reactor:"Reactor", upper_engine:"Upper Engine",
  medbay:"MedBay",
};

function updateEventLog(state) {
  const log   = document.getElementById("event-log");
  const events = state.events || [];
  if (events.length === lastLogLength) return;
  lastLogLength = events.length;

  log.innerHTML = "";
  for (const ev of events) {
    const el  = document.createElement("div");
    el.className = "log-entry " + (ev.tag || "info");
    el.textContent = "[" + String(ev.tick).padStart(3,"0") + "] " + ev.msg;
    log.appendChild(el);
  }
  log.scrollTop = log.scrollHeight;
}

function showMeeting(state) {
  document.getElementById("meeting-overlay").classList.remove("hidden");

  // Title & sub text
  const isBody = state.meeting_type === "body";
  document.getElementById("meeting-title").textContent = isBody
    ? "BODY REPORTED" : "EMERGENCY MEETING";

  let subText = "";
  if (isBody && state.meeting_body) {
    subText = `${state.meeting_body.name}'s body found in ${ROOM_LABELS[state.meeting_body.room] || state.meeting_body.room}`;
    if (state.meeting_caller) subText += ` (reported by ${state.meeting_caller})`;
  } else if (state.meeting_caller) {
    subText = `Called by ${state.meeting_caller}`;
  }
  document.getElementById("meeting-sub").textContent = subText;

  // Timer bar
  const pct = Math.max(0, (state.meeting_timer / MEETING_TICKS) * 100);
  document.getElementById("meeting-timer-bar").style.width = pct + "%";
  document.getElementById("meeting-timer-txt").textContent = Math.max(0, state.meeting_timer) + "s";

  // Player grid
  const grid = document.getElementById("meeting-players");
  grid.innerHTML = "";
  for (const p of state.players) {
    const el = document.createElement("div");
    el.className = "meeting-player" + (p.alive ? "" : " dead");

    const dot = document.createElement("div");
    dot.className  = "meeting-dot";
    dot.style.background = p.color;

    const info = document.createElement("div");
    info.style.flex = "1";

    const nameEl = document.createElement("div");
    nameEl.style.fontWeight = "600";
    nameEl.textContent = p.name;

    const voteEl = document.createElement("div");
    voteEl.className = "meeting-vote-info";
    const vid = state.votes[String(p.id)];
    if (!p.alive) {
      voteEl.textContent = "☠ Dead";
    } else if (vid === undefined) {
      voteEl.textContent = "Thinking…";
    } else if (vid === "skip") {
      voteEl.textContent = "⟳ Skip";
    } else {
      const target = state.players.find(x => x.id === vid);
      voteEl.textContent = target ? "→ " + target.name : "→ ?";
      el.classList.add("voted");
    }

    info.appendChild(nameEl);
    info.appendChild(voteEl);
    el.appendChild(dot);
    el.appendChild(info);
    grid.appendChild(el);
  }
}

function showGameOver(state) {
  const overlay = document.getElementById("gameover-overlay");
  overlay.classList.remove("hidden");

  const crewWin = state.winner === "crewmates";

  const box = document.getElementById("gameover-box");
  box.style.borderColor  = crewWin ? "#132ed1" : "#c51111";
  box.style.color        = crewWin ? "#aaccff" : "#ffaaaa";
  box.style.boxShadow    = crewWin
    ? "0 0 80px rgba(19,46,209,0.4)"
    : "0 0 80px rgba(197,17,17,0.4)";

  document.getElementById("gameover-title").textContent = crewWin ? "CREWMATES WIN" : "IMPOSTORS WIN";
  document.getElementById("gameover-sub").textContent   = crewWin
    ? "The crew successfully completed their mission!"
    : "The impostors have taken control of the ship!";

  const gop = document.getElementById("gameover-players");
  gop.innerHTML = "";
  for (const p of state.players) {
    const el   = document.createElement("div");
    el.className = "go-player" + (p.role === "impostor" ? " impostor" : "") + (p.alive ? "" : " dead");

    const dot  = document.createElement("div");
    dot.className = "go-dot";
    dot.style.background = p.color;

    const label = document.createElement("span");
    label.textContent = p.name + (p.role === "impostor" ? " 🔪" : "");

    el.appendChild(dot);
    el.appendChild(label);
    gop.appendChild(el);
  }
}

// ── Socket.IO connection ───────────────────────────────────────────────────
const socket = io();

socket.on("connect", () => {
  socket.emit("request_state");
});

socket.on("game_state", (state) => {
  applyState(state);
});

// Initial canvas draw on load
window.addEventListener("load", () => {
  resizeCanvas();
  renderMap(null);
});
