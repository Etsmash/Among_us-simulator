import random
import threading
import time
from collections import deque

from .skeld import (
    CONNECTIONS, VENT_CONNECTIONS, ROOM_TASKS, TASK_INFO, SABOTAGES, ROOM_NAMES
)
from .player import Player, PLAYER_COLORS

ALL_COLORS = list(PLAYER_COLORS.keys())

TICK_SPEED = 1.5   # seconds per game tick (default)


class Game:
    def __init__(self, socketio):
        self.socketio = socketio
        self._lock = threading.Lock()
        self._thread = None
        self.running = False
        self.tick_speed = TICK_SPEED

        # Game config
        self.num_players = 10
        self.num_impostors = 2

        # Game state
        self.phase = "lobby"   # lobby | game | meeting | ended
        self.tick = 0
        self.players = []
        self.events = deque(maxlen=120)

        # Meeting state
        self.votes = {}          # {player_id: player_id | "skip" | None}
        self.meeting_caller = None
        self.meeting_type = None  # "body" | "emergency"
        self.meeting_body = None
        self.meeting_timer = 0

        # Sabotage state
        self.sabotage = None       # {type, fixers: set, started_by}
        self.sabotage_timer = 0

        # Result
        self.winner = None
        self.meetings_held = 0
        self.total_kills = 0

        # Suspicion tracking: player_id -> suspicion_score
        self.suspicion: dict = {}

    # ── Public API ────────────────────────────────────────────────────────────

    def configure(self, num_players, num_impostors, tick_speed=TICK_SPEED):
        with self._lock:
            self.num_players  = max(4, min(15, num_players))
            self.num_impostors = max(1, min(3, num_impostors))
            self.tick_speed   = tick_speed

    def start(self):
        self.stop()
        with self._lock:
            self._init_game()
        self.running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self.running = False
        if self._thread:
            self._thread.join(timeout=3)
            self._thread = None

    def get_state(self):
        with self._lock:
            crewmates = [p for p in self.players if p.role == "crewmate"]
            total_tasks = sum(len(p.tasks) for p in crewmates)
            done_tasks  = sum(sum(1 for t in p.tasks if t["done"]) for p in crewmates)
            task_pct    = round(done_tasks / total_tasks * 100, 1) if total_tasks else 0

            sab = None
            if self.sabotage:
                sab = {
                    "type":         self.sabotage["type"],
                    "name":         SABOTAGES[self.sabotage["type"]]["name"],
                    "timer":        self.sabotage_timer,
                    "fixers":       len(self.sabotage["fixers"]),
                    "fixers_needed":SABOTAGES[self.sabotage["type"]]["fixers_needed"],
                    "critical":     SABOTAGES[self.sabotage["type"]]["game_over_if_not_fixed"],
                }

            meeting_body_info = None
            if self.meeting_body:
                meeting_body_info = {
                    "name": self.meeting_body.name,
                    "room": self.meeting_body.room,
                }

            return {
                "phase":        self.phase,
                "tick":         self.tick,
                "winner":       self.winner,
                "task_progress":task_pct,
                "sabotage":     sab,
                "players":      [p.to_dict() for p in self.players],
                "events":       list(self.events)[-30:],
                "votes":        {str(k): v for k, v in self.votes.items()},
                "meeting_timer":self.meeting_timer,
                "meeting_type": self.meeting_type,
                "meeting_body": meeting_body_info,
                "meeting_caller":self.meeting_caller.name if self.meeting_caller else None,
                "meetings_held":self.meetings_held,
                "total_kills":  self.total_kills,
            }

    # ── Initialisation ────────────────────────────────────────────────────────

    def _init_game(self):
        self.phase = "game"
        self.tick = 0
        self.events.clear()
        self.winner = None
        self.sabotage = None
        self.sabotage_timer = 0
        self.votes = {}
        self.meeting_caller = None
        self.meeting_body = None
        self.meeting_timer = 0
        self.meetings_held = 0
        self.total_kills = 0
        self.suspicion = {}

        colors = ALL_COLORS[:self.num_players]
        random.shuffle(colors)
        roles = (["impostor"] * self.num_impostors
                 + ["crewmate"] * (self.num_players - self.num_impostors))
        random.shuffle(roles)

        self.players = []
        for i, (color, role) in enumerate(zip(colors, roles)):
            p = Player(pid=i, name=color, role=role)
            if role == "crewmate":
                self._assign_tasks(p)
            self.players.append(p)

        impostor_names = [p.name for p in self.players if p.role == "impostor"]
        self._log(f"The game has begun aboard The Skeld!", "system")
        self._log(f"{self.num_players} players – {self.num_impostors} impostor(s) among us.", "system")

    def _assign_tasks(self, player):
        pool = []
        for room, tasks in ROOM_TASKS.items():
            for task in tasks:
                pool.append({"room": room, "task": task, "done": False})
        random.shuffle(pool)
        player.tasks = pool[:random.randint(5, 7)]

    # ── Main loop ─────────────────────────────────────────────────────────────

    def _loop(self):
        while self.running:
            with self._lock:
                self.tick += 1
                if self.phase == "game":
                    self._game_tick()
                elif self.phase == "meeting":
                    self._meeting_tick()
                self._check_win()
            self._emit()
            time.sleep(self.tick_speed)

    # ── Game tick ─────────────────────────────────────────────────────────────

    def _game_tick(self):
        # Tick down critical sabotage timer
        if self.sabotage:
            info = SABOTAGES[self.sabotage["type"]]
            if info["game_over_if_not_fixed"]:
                self.sabotage_timer -= 1
                if self.sabotage_timer <= 0:
                    self.phase  = "ended"
                    self.winner = "impostors"
                    self._log(f"Sabotage unfixed! Impostors win!", "sabotage")
                    return

        for player in self.players:
            if self.phase != "game":
                break
            if not player.alive:
                continue
            self._ai_act(player)

    def _ai_act(self, player):
        if player.role == "impostor":
            self._impostor_ai(player)
        else:
            self._crewmate_ai(player)

    # ── Crewmate AI ───────────────────────────────────────────────────────────

    def _crewmate_ai(self, player):
        # Fix critical sabotages first
        if self.sabotage:
            info = SABOTAGES[self.sabotage["type"]]
            if info["game_over_if_not_fixed"]:
                fix_room = info["fix_room"]
                if player.room != fix_room:
                    player.current_task = None
                    player.task_timer   = 0
                    self._move_towards(player, fix_room)
                else:
                    self.sabotage["fixers"].add(player.id)
                    if len(self.sabotage["fixers"]) >= info["fixers_needed"]:
                        sab_name = info["name"]
                        self._log(f"{player.name} fixed the {sab_name}!", "system")
                        self.sabotage = None
                return

        # Finish current task
        if player.current_task:
            player.task_timer -= 1
            if player.task_timer <= 0:
                tname = TASK_INFO[player.current_task["task"]]["name"]
                rname = ROOM_NAMES[player.current_task["room"]]
                player.current_task["done"] = True
                self._log(f"{player.name} completed {tname} in {rname}.", "task")
                player.current_task = None
            return

        # Report dead bodies in same room
        for p in self.players:
            if not p.alive and p.room == player.room and not p.reported:
                p.reported = True
                self._log(f"{player.name} found {p.name}'s body in {ROOM_NAMES[p.room]}!", "report")
                self._call_meeting(player, "body", p)
                return

        # Emergency meeting (must be in cafeteria)
        player.emergency_cooldown = max(0, player.emergency_cooldown - 1)
        if (player.emergency_cooldown == 0
                and player.room == "cafeteria"
                and random.random() < 0.04):
            player.emergency_cooldown = random.randint(50, 80)
            self._log(f"{player.name} called an Emergency Meeting!", "meeting")
            self._call_meeting(player, "emergency")
            return

        # Move to next task
        pending = [t for t in player.tasks if not t["done"]]
        if not pending:
            self._wander(player)
            return

        next_task = pending[0]
        if player.room == next_task["room"]:
            tinfo = TASK_INFO[next_task["task"]]
            player.current_task = next_task
            player.task_timer   = tinfo["duration"]
            rname = ROOM_NAMES[player.room]
            self._log(f"{player.name} started {tinfo['name']} in {rname}.", "info")
        else:
            self._move_towards(player, next_task["room"])

    # ── Impostor AI ───────────────────────────────────────────────────────────

    def _impostor_ai(self, player):
        player.kill_cooldown     = max(0, player.kill_cooldown - 1)
        player.sabotage_cooldown = max(0, player.sabotage_cooldown - 1)

        # Sabotage when cooldown ready and no current sabotage
        if (not self.sabotage
                and player.sabotage_cooldown == 0
                and random.random() < 0.08):
            self._do_sabotage(player)
            return

        # Kill if cooldown ready and alone with a crewmate
        if player.kill_cooldown == 0:
            room_others = [p for p in self.players
                           if p.alive and p.id != player.id and p.room == player.room]
            crewmates_here = [p for p in room_others if p.role == "crewmate"]
            impostors_here = [p for p in room_others if p.role == "impostor"]

            # Kill only when alone with crewmate(s) – no other impostors needed as cover
            if crewmates_here and len(impostors_here) == 0 and len(room_others) <= 2:
                victim = random.choice(crewmates_here)
                self._kill(player, victim)
                return

        # Hunt isolated crewmates
        room_pop = {}
        for p in self.players:
            if p.alive:
                room_pop.setdefault(p.room, []).append(p)

        target_room = None
        # Prefer rooms with exactly 1 crewmate and no impostors
        for room, occ in room_pop.items():
            crew = [p for p in occ if p.role == "crewmate"]
            imps = [p for p in occ if p.role == "impostor"]
            if len(crew) == 1 and not imps and room != player.room:
                target_room = room
                break

        if not target_room:
            alive_crew = [p for p in self.players if p.alive and p.role == "crewmate"]
            if alive_crew:
                target_room = random.choice(alive_crew).room

        if target_room and player.room != target_room:
            # 20% chance to use a vent if available
            if player.room in VENT_CONNECTIONS and random.random() < 0.20:
                dest = random.choice(VENT_CONNECTIONS[player.room])
                old  = ROOM_NAMES[player.room]
                player.room = dest
                self._log(f"{player.name} used a vent from {old}.", "vent")
            else:
                self._move_towards(player, target_room)
        else:
            self._wander(player)

    # ── Kill / Sabotage helpers ───────────────────────────────────────────────

    def _kill(self, killer, victim):
        victim.alive    = False
        victim.reported = False
        killer.kill_cooldown = 18
        self.total_kills += 1
        rname = ROOM_NAMES[victim.room]
        self._log(f"{killer.name} eliminated {victim.name} in {rname}!", "kill")
        # Players who were in the same room or adjacent rooms gain suspicion on the killer
        adjacent = set(CONNECTIONS.get(victim.room, []))
        adjacent.add(victim.room)
        for p in self.players:
            if p.alive and p.role == "crewmate" and p.room in adjacent:
                self.suspicion[killer.id] = self.suspicion.get(killer.id, 0) + 2

    def _do_sabotage(self, player):
        sab_type = random.choice(list(SABOTAGES.keys()))
        info = SABOTAGES[sab_type]
        self.sabotage = {"type": sab_type, "fixers": set(), "started_by": player.id}
        if info["duration"]:
            self.sabotage_timer = info["duration"]
        player.sabotage_cooldown = 30
        self._log(f"{player.name} triggered {info['name']}!", "sabotage")

    # ── Meeting ───────────────────────────────────────────────────────────────

    def _call_meeting(self, caller, mtype, body=None):
        self.phase          = "meeting"
        self.meeting_caller = caller
        self.meeting_type   = mtype
        self.meeting_body   = body
        self.meeting_timer  = 22
        self.meetings_held += 1
        self.votes          = {}
        self.sabotage       = None  # meetings cancel non-critical sabotages

        for p in self.players:
            if p.alive:
                p.vote_delay = random.randint(1, 6)

        if mtype == "body":
            self._log(f"=== EMERGENCY MEETING – Body reported by {caller.name} ===", "meeting")
        else:
            self._log(f"=== EMERGENCY MEETING – Called by {caller.name} ===", "meeting")

    def _meeting_tick(self):
        # Players vote with individual delays for drama
        for p in self.players:
            if p.alive and p.id not in self.votes:
                p.vote_delay -= 1
                if p.vote_delay <= 0:
                    self._ai_vote(p)

        self.meeting_timer -= 1
        if self.meeting_timer <= 0 or all(
            p.id in self.votes for p in self.players if p.alive
        ):
            self._resolve_votes()

    def _ai_vote(self, player):
        alive_others = [p for p in self.players if p.alive and p.id != player.id]

        if player.role == "impostor":
            # Vote for crewmate; occasionally try to redirect suspicion
            crew_targets = [p for p in alive_others if p.role == "crewmate"]
            if crew_targets and random.random() < 0.65:
                target = random.choice(crew_targets)
                self.votes[player.id] = target.id
                self._log(f"{player.name} voted for {target.name}.", "vote")
            else:
                self.votes[player.id] = "skip"
                self._log(f"{player.name} skipped.", "vote")
        else:
            # Crewmate: use suspicion data if available
            suspects = sorted(
                [(pid, sc) for pid, sc in self.suspicion.items()
                 if any(p.id == pid and p.alive for p in alive_others)],
                key=lambda x: -x[1],
            )
            if suspects and random.random() < 0.55:
                # Vote for most suspicious alive player
                top_pid = suspects[0][0]
                target  = next(p for p in alive_others if p.id == top_pid)
                self.votes[player.id] = target.id
                self._log(f"{player.name} is suspicious of {target.name}!", "vote")
            elif alive_others and random.random() < 0.65:
                target = random.choice(alive_others)
                self.votes[player.id] = target.id
                self._log(f"{player.name} voted for {target.name}.", "vote")
            else:
                self.votes[player.id] = "skip"
                self._log(f"{player.name} skipped.", "vote")

    def _resolve_votes(self):
        counts = {}
        for vid in self.votes.values():
            if vid and vid != "skip":
                counts[vid] = counts.get(vid, 0) + 1

        if not counts:
            self._log("No majority – nobody was ejected.", "meeting")
            self.phase = "game"
            self._reset_after_meeting()
            return

        max_v   = max(counts.values())
        top     = [pid for pid, c in counts.items() if c == max_v]

        if len(top) > 1:
            self._log("Tied vote – nobody was ejected.", "meeting")
            self.phase = "game"
            self._reset_after_meeting()
            return

        ejected = next(p for p in self.players if p.id == top[0])
        ejected.alive = False
        role_txt = "was an Impostor" if ejected.role == "impostor" else "was NOT an Impostor"
        self._log(f"{ejected.name} was ejected. {ejected.name} {role_txt}!", "eject")
        self.phase = "game"
        self._reset_after_meeting()

    def _reset_after_meeting(self):
        for p in self.players:
            if p.role == "impostor" and p.alive:
                p.kill_cooldown = 10
        self.suspicion = {}

    # ── Win conditions ────────────────────────────────────────────────────────

    def _check_win(self):
        if self.phase == "ended":
            return

        alive_imp  = [p for p in self.players if p.alive and p.role == "impostor"]
        alive_crew = [p for p in self.players if p.alive and p.role == "crewmate"]

        if len(alive_imp) == 0:
            self.phase  = "ended"
            self.winner = "crewmates"
            self._log("=== CREWMATES WIN – All impostors eliminated! ===", "win")
            self.running = False
            return

        if len(alive_imp) >= len(alive_crew):
            self.phase  = "ended"
            self.winner = "impostors"
            self._log("=== IMPOSTORS WIN – They outnumber the crew! ===", "win")
            self.running = False
            return

        # Task-completion win
        crew = [p for p in self.players if p.role == "crewmate"]
        total = sum(len(p.tasks) for p in crew)
        done  = sum(sum(1 for t in p.tasks if t["done"]) for p in crew)
        if total > 0 and done >= total:
            self.phase  = "ended"
            self.winner = "crewmates"
            self._log("=== CREWMATES WIN – All tasks completed! ===", "win")
            self.running = False

    # ── Movement / pathfinding ────────────────────────────────────────────────

    def _move_towards(self, player, target):
        if player.room == target:
            return
        path = self._bfs(player.room, target)
        if path and len(path) > 1:
            player.room = path[1]

    def _bfs(self, start, end):
        if start == end:
            return [start]
        queue   = [[start]]
        visited = {start}
        while queue:
            path = queue.pop(0)
            for nb in CONNECTIONS.get(path[-1], []):
                if nb == end:
                    return path + [nb]
                if nb not in visited:
                    visited.add(nb)
                    queue.append(path + [nb])
        return [start]

    def _wander(self, player):
        if random.random() < 0.35:
            nbs = CONNECTIONS.get(player.room, [])
            if nbs:
                player.room = random.choice(nbs)

    # ── Logging / emitting ────────────────────────────────────────────────────

    def _log(self, msg, tag="info"):
        self.events.append({"tick": self.tick, "msg": msg, "tag": tag})

    def _emit(self):
        self.socketio.emit("game_state", self.get_state())
