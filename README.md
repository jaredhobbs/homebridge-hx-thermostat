# homebridge-hx-thermostat
Hx thermostat plugin for [HomeBridge](https://github.com/nfarina/homebridge).
Tested with the Hx3 thermostat.

# Installation

1. Install homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g homebridge-hx-thermostat`
3. Update your configuration file. See `sample-config.json` snippet below.

_Note: The name of the device matches the name displayed in the Hx thermostat app._

# Configuration

Configuration sample:

 ```
"platforms": [
    {
        "platform": "HxThermostat",
        "email": "the email used to login to the Hx thermostat app",
        "password": "the password used to login to the Hx thermostat app"
    }
]
```

Fields:

* "platform": Must always be "HxThermostat" (required)
* "email": the email used to login to the Hx thermostat app
* "password": the password used to login to the Hx thermostat app
