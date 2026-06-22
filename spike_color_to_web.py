from pybricks.pupdevices import ColorSensor, Motor, UltrasonicSensor
from pybricks.parameters import Port, Color
from pybricks.tools import wait
from pybricks.hubs import PrimeHub

hub = PrimeHub()
color_sensor = ColorSensor(Port.D)       # match the port you tested earlier
motor = Motor(Port.C)                    # drive motor
distance_sensor = UltrasonicSensor(Port.F)  # front-facing ultrasonic sensor

DRIVE_SPEED = 300         # deg/s while moving forward
STOP_DURATION_MS = 10000  # how long to wait at a detected station
CLEAR_TILE_MS = 5000      # blind drive after cooldown, to get off the current tile
START_DISTANCE_MM = 100   # person/object must be closer than this (mm) to toggle on/off
TOGGLE_GRACE_MS = 2000    # ignore the sensor briefly after toggling, so the same
                          # person standing there doesn't immediately toggle it back

# Calibrated from actual readings of each tile (via color_sensor.hsv()), averaged
# across multiple sample points per tile. We only use color_sensor.color() to
# decide whether a tile is present at all (vs. plain floor) — picking *which*
# color it is happens ourselves via classify_color() below, using the raw hsv()
# reading. Pybricks' own nearest-color matching doesn't reliably wrap hue across
# the 0/360 boundary, so a Red tile reading H=0 (sensor noise near H=354-356)
# was getting matched to Violet (H=339) by raw linear distance instead of the
# correct ~6-degree circular distance to Red.
CALIBRATED_COLORS = (
    ("YELLOW", 64, 40, 68),
    ("BLUE", 230, 70, 31),
    ("GREEN", 164, 71, 35),
    ("CYAN", 207, 84, 74),
    ("WHITE", 221, 36, 76),
    ("RED", 355, 79, 33),
    ("VIOLET", 339, 82, 37),
)

color_sensor.detectable_colors((
    Color.BLACK, Color.RED, Color.YELLOW, Color.GREEN,
    Color.BLUE, Color.CYAN, Color.VIOLET, Color.WHITE,
))


def _hue_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def classify_color(h, s, v):
    best_label = None
    best_dist = None
    for label, ch, cs, cv in CALIBRATED_COLORS:
        # RED and VIOLET sit only ~16 degrees apart in hue, close enough that
        # sensor noise (including hue wrapping near 0/360) makes hue alone
        # unreliable for telling them apart — weight brightness more heavily
        # for just this pair, since it separates them more consistently.
        v_weight = 2.0 if label in ("RED", "VIOLET") else 0.8
        dist = _hue_diff(h, ch) ** 2 + (0.5 * (s - cs)) ** 2 + (v_weight * (v - cv)) ** 2
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_label = label
    return best_label

ON_ICON = [
    [0, 0, 0, 0, 100],
    [0, 0, 0, 100, 0],
    [100, 0, 100, 0, 0],
    [0, 100, 0, 0, 0],
    [0, 0, 0, 0, 0],
]  # checkmark = running

OFF_ICON = [
    [100, 0, 0, 0, 100],
    [0, 100, 0, 100, 0],
    [0, 0, 100, 0, 0],
    [0, 100, 0, 100, 0],
    [100, 0, 0, 0, 100],
]  # X = stopped


def _hue_diff(a, b):
    d = abs(a - b) % 360
    return min(d, 360 - d)


def interruptible_wait(duration_ms):
    """Wait up to duration_ms, but check the ultrasonic sensor every 100ms
    instead of blocking — returns True early if someone/something is detected."""
    elapsed = 0
    while elapsed < duration_ms:
        if distance_sensor.distance() < START_DISTANCE_MM:
            return True
        wait(100)
        elapsed += 100
    return False


hub.display.icon(OFF_ICON)

while True:
    # OFF — wait for someone within range to turn it on.
    while distance_sensor.distance() >= START_DISTANCE_MM:
        wait(100)
    hub.display.icon(ON_ICON)
    wait(TOGGLE_GRACE_MS)
    motor.run(DRIVE_SPEED)

    # ON — drive + detect colors. The ultrasonic sensor is checked continuously
    # (including during the station stop and the blind clear-the-tile drive),
    # so a person/object in front always stops the rover immediately.
    turned_off = False
    while not turned_off:
        if distance_sensor.distance() < START_DISTANCE_MM:
            turned_off = True
            break

        detected = color_sensor.color()
        if detected is not Color.BLACK and detected is not Color.NONE:
            raw = color_sensor.hsv()
            motor.stop()
            print(classify_color(raw.h, raw.s, raw.v))  # web app picks this up and navigates

            if interruptible_wait(STOP_DURATION_MS):
                turned_off = True
                break

            motor.run(DRIVE_SPEED)

            if interruptible_wait(CLEAR_TILE_MS):
                turned_off = True
                break
        wait(100)

    motor.stop()
    hub.display.icon(OFF_ICON)
    print("OFF")  # web app picks this up and returns to the Idle screen
    wait(TOGGLE_GRACE_MS)
