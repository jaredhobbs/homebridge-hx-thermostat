const HxClient = require('./lib/client');

let Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;
  homebridge.registerPlatform("homebridge-hx-thermostat", "HxThermostat", HxThermostatPlatform);
};

function HxThermostatPlatform(log, config, api) {
  // Homebridge
  this.api = api;
  this.log = log;
  this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));

  // Base Config
  this.name = config.name || "Hx3 Thermostat";
  this.email = config.email;
  if (!this.email) throw new Error("'email' is required!");
  this.password = config.password;
  if (!this.password) throw new Error("'password' is required!");

  this.interval = (config.interval * 1000) || 10000;
  this.displayUnits = {
    'C': 0,
    'F': 1
  }[config.displayUnits || 'F'];
  this.accessories = {};
  this.client = new HxClient(log);
}

HxThermostatPlatform.prototype.configureAccessory = function (accessory) {
  const dsn = accessory.context.dsn;
  this.log.debug(`configureAccessory: ${dsn}`);

  // Handle rename case. Depending on which order the accessories come back in, we will want to handle them differently below
  if (this.accessories[dsn]) {
    this.log.warn(`Duplicate accessory detected, removing existing if possible, otherwise removing this accessory ${dsn}`);
    try {
      this.removeAccessory(this.accessories[dsn], dsn);
      this.setService(accessory);
    } catch (error) {
      this.removeAccessory(accessory, dsn);
      accessory = this.accessories[dsn];
    }
  } else {
    this.setService(accessory);
  }

  this.accessories[dsn] = accessory;
};

HxThermostatPlatform.prototype.didFinishLaunching = function () {
  const that = this;

  this.deviceDiscovery();
  setInterval(that.deviceDiscovery.bind(that), this.interval * 6000);
};

HxThermostatPlatform.prototype.deviceDiscovery = async function () {
  const me = this;
  me.log.debug("DeviceDiscovery invoked");

  if (!this.client.token) {
    this.log("Authenticating...");
    await this.client.login(this.email, this.password);
  }
  this.log.debug("token is: " + this.client.token);

  this.log.debug("fetching devices...");
  const devices = await this.client.getDevices();
  devices.forEach(({device}) => {
    if (!this.accessories[device.dsn]) {
      this.log(`Adding device: ${device.dsn} - ${device.product_name}`);
      this.addAccessory(device);
    } else {
      this.log.debug(`Skipping existing device ${device.dsn}`);
    }
  });
  if (devices.length > 0) {
    Object.keys(this.accessories).forEach((dsn) => {
      const acc = this.accessories[dsn];
      if (acc) {
        const found = devices.find((device) => device.device.dsn === dsn);
        if (!found) {
          this.log(`Removing previously configured accessory that no longer exists ${dsn}`);
          this.removeAccessory(acc);
        } else if (found.device.product_name !== acc.context.name) {
          this.log(`Accessory name does not match device name. Got ${found.device.product_name} but expected ${acc.context.name}`);
          this.removeAccessory(acc);
          this.addAccessory(found);
          this.log('Accessory removed and re-added!');
        }
      }
    });
  }
};

HxThermostatPlatform.prototype.addAccessory = function (data) {
  this.log.debug(`Adding accessory ${JSON.stringify(data)}`);
  let newAccessory;
  if (!this.accessories[data.dsn]) {
    const uuid = UUIDGen.generate(data.dsn);
    newAccessory = new Accessory(data.dsn, uuid, 8);
    newAccessory.context.name = data.product_name;
    newAccessory.context.dsn = data.dsn;
    newAccessory.context.firmwareRevision = data.sw_version;
    newAccessory.context.model = data.model;
    newAccessory.context.online = data.connection_status === 'Online';
    newAccessory.context.indoorTemp = 0;
    newAccessory.context.targettemp = 0;
    newAccessory.context.currentstate = 0;
    newAccessory.context.minSetpoint = 0;
    newAccessory.context.maxSetpoint = 0;
    newAccessory.context.heatTo = 0;
    newAccessory.context.coolTo = 0;
    newAccessory.context.displayUnits = this.displayUnits;
    newAccessory.addService(Service.Thermostat, data.product_name);
    this.setService(newAccessory);
    this.api.registerPlatformAccessories("homebridge-hx-thermostat", "HxThermostat", [newAccessory]);
  } else {
    newAccessory = this.accessories[data.dsn];
    this.setService(newAccessory);
  }

  this.getInitState(newAccessory);
  this.accessories[data.dsn] = newAccessory;
  this.log.debug(`Added accessory ${JSON.stringify(data)}`);
};

HxThermostatPlatform.prototype.removeAccessory = function (accessory, dsn = undefined) {
  if (accessory) {
    const id = dsn !== undefined ? dsn : (accessory.context === undefined ? undefined : accessory.context.dsn); // eslint-disable-line no-nested-ternary
    this.log.debug(`Removing accessory ${id}`);

    try {
      this.api.unregisterPlatformAccessories("homebridge-hx-thermostat", "HxThermostat", [accessory]);
    } catch (error) {
      // in case its already been deregistered, don't crash. remove from plugin's accessories context below
      this.log.debug(error);
    }

    // Remove from local accessories context if id is defined
    if (id !== undefined) {
      delete this.accessories[id];
    }
  }
};

HxThermostatPlatform.prototype.getInitState = function (accessory) {
  const info = accessory.getService(Service.AccessoryInformation);

  accessory.context.manufacturer = "Johnson Controls";
  info.setCharacteristic(Characteristic.Manufacturer, accessory.context.manufacturer);
  info.setCharacteristic(Characteristic.Model, accessory.context.model);
  info.setCharacteristic(Characteristic.SerialNumber, accessory.context.dsn);
  info.setCharacteristic(Characteristic.FirmwareRevision, accessory.context.firmwareRevision);
};

HxThermostatPlatform.prototype.inCelsius = function (displayUnits, val) {
  if (displayUnits === 1) {
    return (val - 32) / 1.8;
  }
  return val;
};

HxThermostatPlatform.prototype.toFahrenheit = function (val) {
  return (val * 1.8) + 32;
};

HxThermostatPlatform.prototype.setService = async function (accessory) {
  if (!this.client.token) {
    this.log("Authenticating...");
    await this.client.login(this.email, this.password);
  }
  const props = await this.client.getProperties(accessory.context.dsn);
  accessory.context = {
    ...accessory.context,
    ...props
  };
  this.log(`Temperature can be set between ${accessory.context.minSetpoint} and ${accessory.context.maxSetpoint} ${accessory.context.displayUnits === 1 ? 'f' : 'c'}`);
  this.log.debug(accessory.context);
  const service = accessory.getService(Service.Thermostat);
  service.getCharacteristic(Characteristic.CurrentTemperature)
    .setProps({
      format: Characteristic.Formats.UINT8,
      minValue: -100,
      maxValue: 100,
      minStep: 1
    })
    .on('get', this.getCurrentTemperature.bind(this, accessory.context))
    .updateValue(accessory.context.indoorTemp);

  service.getCharacteristic(Characteristic.TargetTemperature)
    .setProps({
      minValue: Math.max(this.inCelsius(accessory.context.displayUnits, accessory.context.minSetpoint), 0),
      maxValue: Math.min(this.inCelsius(accessory.context.displayUnits, accessory.context.maxSetpoint), 50),
      minStep: 1
    })
    .on('get', this.getTargetTemperature.bind(this, accessory.context))
    .on('set', this.setTargetTemperature.bind(this, accessory.context))
    .updateValue(accessory.context.targettemp);

  service.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .setProps({
      format: Characteristic.Formats.UINT8,
      maxValue: 3,
      minValue: 0,
      validValues: [0, 1, 2, 3],
      perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
    })
    .on('get', this.getCurrentState.bind(this, accessory.context))
    .updateValue(accessory.context.currentstate);
  Characteristic.CurrentHeatingCoolingState.AUTO = 3;

  service.getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .setProps({
      format: Characteristic.Formats.UINT8,
      maxValue: 3,
      minValue: 0,
      validValues: [0, 1, 2, 3],
      perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
    })
    .on('get', this.getCurrentState.bind(this, accessory.context))
    .on('set', this.setTargetHeatingCoolingState.bind(this, accessory.context))
    .updateValue(accessory.context.currentstate);

  service.getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .on('get', this.getTemperatureDisplayUnits.bind(this, accessory.context))
    .on('set', this.setTemperatureDisplayUnits.bind(this, accessory.context))
    .updateValue(accessory.context.displayUnits);

  accessory.on('identify', this.identify.bind(this, accessory.context));
};

HxThermostatPlatform.prototype.getCurrentTemperature = async function (thermostat, callback) {
  if (this.accessories[thermostat.dsn]) {
    const val = await this.client.getCurrentTemperature(thermostat.dsn);
    thermostat.indoorTemp = val;
    this.log(`Current temperature is ${val}${thermostat.displayUnits === 1 ? 'f' : 'c'}`);
    callback(null, this.inCelsius(thermostat.displayUnits, val));
  } else {
    callback(new Error("Device not found"));
  }
};

HxThermostatPlatform.prototype.getTemperatureDisplayUnits = function (thermostat, callback) {
  if (this.accessories[thermostat.dsn]) {
    thermostat.displayUnits = this.displayUnits;
    this.log(`Current display units is ${thermostat.displayUnits === 1 ? 'f' : 'c'}`);
    callback(null, thermostat.displayUnits);
  } else {
    callback(new Error("Device not found"));
  }
};

HxThermostatPlatform.prototype.setTemperatureDisplayUnits = function (thermostat, value, callback) {
  if (this.accessories[thermostat.dsn]) {
    thermostat.displayUnits = value;
    this.displayUnits = value;
    callback(null, value);
  } else {
    callback(new Error("Device not found"));
  }
};

HxThermostatPlatform.prototype.getCurrentState = async function (thermostat, callback) {
  if (this.accessories[thermostat.dsn]) {
    const val = await this.client.getCurrentState(thermostat.dsn);
    thermostat.currentstate = val;
    this.log(`Current heating cooling state is ${val}`);
    callback(null, val);
  } else {
    callback(new Error("Device not found"));
  }
};

HxThermostatPlatform.prototype.setTargetHeatingCoolingState = async function (thermostat, value, callback) {
  this.log.debug(`Setting state from ${thermostat.currentstate} to ${value}`);
  try {
    if (await this.client.setTargetState(thermostat.dsn, value)) {
      thermostat.currentstate = value;
      callback();
    }
  } catch (error) {
    this.log(thermostat.name + " setTargetHeatingCoolingState error - " + error);
    callback(error);
  }
};

HxThermostatPlatform.prototype.getTargetTemperature = async function (thermostat, callback) {
  if (this.accessories[thermostat.dsn]) {
    const val = await this.client.getTargetTemperature(thermostat.dsn);
    thermostat.targettemp = val;
    this.log(`Target temperature is ${val}${thermostat.displayUnits === 1 ? 'f' : 'c'}`);
    callback(null, this.inCelsius(thermostat.displayUnits, val));
  } else {
    callback(new Error("Device not found"));
  }
};

HxThermostatPlatform.prototype.setTargetTemperature = async function (thermostat, value, callback) {
  this.log.debug(`setting temperature to ${value}c`);
  this.log.debug(JSON.stringify(thermostat));
  if (thermostat.currentstate === 0) {
    this.log("Can't set new Temperature, Thermostat is off");
    callback();
    return;
  }

  if (this.displayUnits === 1) {
    value = this.toFahrenheit(value);
  }

  let heatTo = thermostat.heatTo;
  let coolTo = thermostat.coolTo;

  if (thermostat.currentstate === 1) {
    // heat
    heatTo = value;
  } else if (thermostat.currentstate === 2) {
    // cool
    coolTo = value;
  }

  try {
    const val = await this.client.setTargetTemperature(thermostat.dsn, heatTo, coolTo);
    if (val !== null) {
      thermostat.targettemp = value;
      thermostat.heatTo = heatTo;
      thermostat.coolTo = coolTo;
      callback();
    } else {
      callback(new Error('Failed to set temperature'));
    }
  } catch (error) {
    callback(error);
  }
};

HxThermostatPlatform.prototype.identify = function(thermostat, paired, callback) {
  this.log("Identify requested for " + thermostat.name);
  callback();
};
