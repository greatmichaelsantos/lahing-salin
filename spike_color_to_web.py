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

# Only these colors correspond to a station — anything else (e.g. Color.NONE,
# the floor between tiles) is ignored so the rover keeps driving through it.
VALID_COLORS = {
    Color.YELLOW, Color.RED, Color.BLUE, Color.GREEN,
    Color.CYAN, Color.WHITE, Color.VIOLET,
}

# color_sensor.color() only ever returns a color from this candidate set — by
# default that set is just {BLACK, WHITE, RED, YELLOW, GREEN, BLUE}, so CYAN and
# VIOLET readings were being rounded to the nearest of those instead of matched
# correctly. Explicitly registering all 8 colors fixes that.
color_sensor.detectable_colors((
    Color.BLACK, Color.WHITE, Color.RED, Color.YELLOW,
    Color.GREEN, Color.BLUE, Color.CYAN, Color.VIOLET,
))

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
        if detected in VALID_COLORS:
            motor.stop()
            print(detected)  # web app picks this up and navigates

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
