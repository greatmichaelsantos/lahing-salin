from pybricks.pupdevices import ColorSensor
from pybricks.parameters import Port
from pybricks.tools import wait
from pybricks.hubs import PrimeHub

hub = PrimeHub()
color_sensor = ColorSensor(Port.D)  # match the port you tested earlier

while True:
    hub.display.icon([
        [0, 0, 100, 0, 0],
        [0, 0, 100, 0, 0],
        [100, 100, 100, 100, 100],
        [0, 0, 100, 0, 0],
        [0, 0, 100, 0, 0],
    ])
    print(color_sensor.color())
    wait(300)
