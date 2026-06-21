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

# Calibrated from actual readings of each tile (via color_sensor.hsv()) rather
# than Pybricks' generic default hues — measured tiles can land far enough from
# the "textbook" hue that default matching picks the wrong color entirely
# (e.g. our green tile measured closer to default cyan than to default green).
CUSTOM_YELLOW = Color(64, 40, 68)
CUSTOM_RED = Color(354, 75, 30)
CUSTOM_BLUE = Color(230, 70, 31)
CUSTOM_GREEN = Color(164, 71, 35)
CUSTOM_CYAN = Color(207, 84, 74)
CUSTOM_VIOLET = Color(340, 80, 40)
CUSTOM_WHITE = Color(221, 36, 76)

color_sensor.detectable_colors((
    Color.BLACK,
    CUSTOM_YELLOW, CUSTOM_RED, CUSTOM_BLUE,
    CUSTOM_GREEN, CUSTOM_CYAN, CUSTOM_VIOLET, CUSTOM_WHITE,
))

# color_sensor.color() now returns one of the calibrated objects above (not the
# generic Color.GREEN etc.), so map each one to the text label the web app
# matches on instead of relying on print()'s default representation.
COLOR_LABELS = {
    CUSTOM_YELLOW: "YELLOW",
    CUSTOM_RED: "RED",
    CUSTOM_BLUE: "BLUE",
    CUSTOM_GREEN: "GREEN",
    CUSTOM_CYAN: "CYAN",
    CUSTOM_VIOLET: "VIOLET",
    CUSTOM_WHITE: "WHITE",
}

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


def resolve_red_violet(detected):
    """RED (h=354) and VIOLET (h=340) are only 14 degrees apart in hue, close
    enough that sensor noise can flip the built-in match either way. Brightness
    is the more reliable signal between these two specifically (RED measured
    v=30, VIOLET measured v=40), so re-check with it before committing."""
    if detected is not CUSTOM_RED and detected is not CUSTOM_VIOLET:
        return COLOR_LABELS[detected]
    raw = color_sensor.hsv()
    dist_red = abs(raw.v - 30) * 2 + _hue_diff(raw.h, 354)
    dist_violet = abs(raw.v - 40) * 2 + _hue_diff(raw.h, 340)
    return "RED" if dist_red <= dist_violet else "VIOLET"


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
        if detected in COLOR_LABELS:
            motor.stop()
            print(resolve_red_violet(detected))  # web app picks this up and navigates

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
