import random


PLAYER_COLORS = {
    "Red":    "#C51111",
    "Blue":   "#132ED1",
    "Green":  "#117F2D",
    "Purple": "#6B2FBB",
    "Yellow": "#F9F748",
    "Orange": "#EF7D0E",
    "Pink":   "#EC54BB",
    "Black":  "#3F474E",
    "White":  "#D6DFF1",
    "Brown":  "#71491E",
    "Cyan":   "#38FEDC",
    "Lime":   "#50EF39",
}


class Player:
    def __init__(self, pid, name, role):
        self.id = pid
        self.name = name
        self.color = PLAYER_COLORS.get(name, "#AAAAAA")
        self.role = role            # "crewmate" | "impostor"
        self.alive = True
        self.room = "cafeteria"     # start in cafeteria

        # Task state
        self.tasks = []             # [{room, task, done}]
        self.current_task = None    # ref into self.tasks while working
        self.task_timer = 0

        # AI cooldowns
        self.kill_cooldown = 15
        self.sabotage_cooldown = 20
        self.emergency_cooldown = random.randint(20, 40)
        self.vote_delay = 0         # ticks before casting vote in a meeting

        # Body state
        self.reported = False       # True once a crewmate has reported this corpse

    def to_dict(self):
        tasks_total = len(self.tasks)
        tasks_done  = sum(1 for t in self.tasks if t["done"])
        return {
            "id":               self.id,
            "name":             self.name,
            "color":            self.color,
            "role":             self.role,
            "alive":            self.alive,
            "room":             self.room,
            "tasks_total":      tasks_total,
            "tasks_done":       tasks_done,
            "current_task":     self.current_task["task"] if self.current_task else None,
            "current_task_room":self.current_task["room"] if self.current_task else None,
        }
