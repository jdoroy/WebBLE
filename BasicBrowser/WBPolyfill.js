/*jslint
        browser
*/
/*global
        atob, Event, nslog, uk, window
*/
//  Copyright 2016-2017 Paul Theriault and David Park. All rights reserved.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the License.
//  You may obtain a copy of the License at
//
//  http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing, software
//  distributed under the License is distributed on an "AS IS" BASIS,
//  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//  See the License for the specific language governing permissions and
//  limitations under the License.
// adapted from chrome app polyfill https://github.com/WebBluetoothCG/chrome-app-polyfill

(function () {
  'use strict';

  const wbutils = uk.co.greenparksoftware.wbutils;
  nslog('Initialize web bluetooth runtime');

  if (navigator.bluetooth) {
    // already exists, don't polyfill
    nslog('navigator.bluetooth already exists, skipping polyfill');
    return;
  }

  let native;

  function defineROProperties(target, roDescriptors) {
    Object.keys(roDescriptors).forEach(function (key) {
      Object.defineProperty(target, key, {value: roDescriptors[key]});
    });
  }

  // https://webbluetoothcg.github.io/web-bluetooth/ interface
  nslog('Create BluetoothDevice');
  function BluetoothDevice(deviceJSON) {
    wbutils.EventTarget.call(this);

    let roProps = {
      adData: {},
      deviceClass: deviceJSON.deviceClass || 0,
      id: deviceJSON.id,
      gatt: new native.BluetoothRemoteGATTServer(this),
      productId: deviceJSON.productId || 0,
      productVersion: deviceJSON.productVersion || 0,
      uuids: deviceJSON.uuids,
      vendorId: deviceJSON.vendorId || 0,
      vendorIdSource: deviceJSON.vendorIdSource || 'bluetooth'
    };
    defineROProperties(this, roProps);

    this.name = deviceJSON.name;

    if (deviceJSON.adData) {
      this.adData.appearance = deviceJSON.adData.appearance || '';
      this.adData.txPower = deviceJSON.adData.txPower || 0;
      this.adData.rssi = deviceJSON.adData.rssi || 0;
      this.adData.manufacturerData = deviceJSON.adData.manufacturerData || [];
      this.adData.serviceData = deviceJSON.adData.serviceData || [];
    }
  }

  BluetoothDevice.prototype = {
    toString: function () {
      return `BluetoothDevice(${this.id.slice(0, 10)})`;
    },
    handleSpontaneousDisconnectEvent: function () {
      // Code references as per
      // https://webbluetoothcg.github.io/web-bluetooth/#disconnection-events
      // 1. not implemented
      // 2.
      if (!this.gatt.connected) {
        return;
      }
      // 3.1
      this.gatt.connected = false;
      // 3.2-3.7 not implemented
      // 3.8
      this.dispatchEvent(new native.BluetoothEvent('gattserverdisconnected', this));
    }
  };
  wbutils.mixin(BluetoothDevice, wbutils.EventTarget);

  nslog('Create BluetoothRemoteGATTServer');
  function BluetoothRemoteGATTServer(webBluetoothDevice) {
    if (webBluetoothDevice === undefined) {
      throw new Error('Attempt to create BluetoothRemoteGATTServer with no device');
    }
    defineROProperties(this, {device: webBluetoothDevice});
    this.connected = false;
    this.connectionTransactionIDs = [];
  }
  BluetoothRemoteGATTServer.prototype = {
    connect: function () {
      let self = this;
      let tid = native.getTransactionID();
      this.connectionTransactionIDs.push(tid);
      return this.sendMessage('connectGATT', {callbackID: tid}).then(function () {
        self.connected = true;
        native.registerDeviceForNotifications(self.device);
        self.connectionTransactionIDs.splice(
          self.connectionTransactionIDs.indexOf(tid),
          1
        );

        return self;
      });
    },
    disconnect: function () {
      this.connectionTransactionIDs.forEach((tid) => native.cancelTransaction(tid));
      this.connectionTransactionIDs = [];
      if (!this.connected) {
        return;
      }
      this.connected = false;

      // since we've set connected false this event won't be generated
      // by the shortly to be dispatched disconnect event.
      this.device.dispatchEvent(new native.BluetoothEvent('gattserverdisconnected', this.device));
      native.unregisterDeviceForNotifications(this.device);
      // If there were two devices pointing at the same underlying device
      // this would break both connections, so not really what we want,
      // but leave it like this till someone complains.
      this.sendMessage('disconnectGATT');
    },
    getPrimaryService: function (UUID) {
      let canonicalUUID = window.BluetoothUUID.getService(UUID);
      let self = this;
      return this.sendMessage(
        'getPrimaryService',
        {data: {serviceUUID: canonicalUUID}}
      ).then(() => new native.BluetoothRemoteGATTService(
        self.device,
        canonicalUUID,
        true
      ));
    },

    getPrimaryServices: function (UUID) {
      if (true) {
        throw new Error('Not implemented');
      }
      let device = this.device;
      let canonicalUUID = window.BluetoothUUID.getService(UUID);
      return this.sendMessage(
        'getPrimaryServices', {data: {serviceUUID: canonicalUUID}}
      ).then(function (servicesJSON) {
        let servicesData = JSON.parse(servicesJSON);
        let services = servicesData;
        services = device;
        services = [];

        // this is a problem - all services will have the same information (UUID) so no way for this side of the code to differentiate.
        // we need to add an identifier GUID to tell them apart
        // servicesData.forEach(
        //     (service) => services.push(
        //         new native.BluetoothRemoteGATTService(device, canonicalUUID, true)
        //     )
        // );
        return services;
      });
    },
    sendMessage: function (type, messageParms) {
      messageParms = messageParms || {};
      messageParms.data = messageParms.data || {};
      messageParms.data.deviceId = this.device.id;
      return native.sendMessage('device:' + type, messageParms);
    },
    toString: function () {
      return `BluetoothRemoteGATTServer(${this.device.toString()})`;
    }
  };

  nslog('Create BluetoothRemoteGATTService');
  function BluetoothRemoteGATTService(device, uuid, isPrimary) {
    if (device === undefined || uuid === undefined || isPrimary === undefined) {
      throw new Error('Invalid call to BluetoothRemoteGATTService constructor');
    }
    defineROProperties(this, {
      device: device,
      uuid: uuid,
      isPrimary: isPrimary
    });
  }

  BluetoothRemoteGATTService.prototype = {
    getCharacteristic: function (uuid) {
      let canonicalUUID = window.BluetoothUUID.getCharacteristic(uuid);
      let service = this;
      return this.sendMessage(
        'getCharacteristic',
        {data: {characteristicUUID: canonicalUUID}}
      ).then(function (CharacteristicJSON) {
        nslog(`Got characteristic ${uuid}`);
        return new native.BluetoothRemoteGATTCharacteristic(
          service,
          canonicalUUID,
          CharacteristicJSON.properties
        );
      });
    },
    getCharacteristics: function () {
      throw new Error('Not implemented');
    },
    getIncludedService: function () {
      throw new Error('Not implemented');
    },
    getIncludedServices: function () {
      throw new Error('Not implemented');
    },
    sendMessage: function (type, messageParms) {
      messageParms = messageParms || {};
      messageParms.data = messageParms.data || {};
      messageParms.data.serviceUUID = this.uuid;
      return this.device.gatt.sendMessage(type, messageParms);
    },
    toString: function () {
      return `BluetoothRemoteGATTService(${this.uuid})`;
    }
  };

  nslog('Create BluetoothRemoteGATTCharacteristic');
  function BluetoothRemoteGATTCharacteristic(service, uuid, properties) {
    nslog(`New BluetoothRemoteGATTCharacteristic ${uuid}`);
    let roProps = {
      service: service,
      properties: properties,
      uuid: uuid
    };
    defineROProperties(this, roProps);
    this.value = null;
    wbutils.EventTarget.call(this);
    native.registerCharacteristicForNotifications(this);
  }

  BluetoothRemoteGATTCharacteristic.prototype = {
    getDescriptor: function () {
      throw new Error('Not implemented');
    },
    getDescriptors: function () {
      throw new Error('Not implemented');
    },
    readValue: function () {
      let char = this;
      return this.sendMessage('readCharacteristicValue').then(function (valueEncoded) {
        char.value = wbutils.str64todv(valueEncoded);
        return char.value;
      });
    },
    writeValue: function (value) {
      let buffer;
      if (value instanceof ArrayBuffer) {
        buffer = value;
      } else {
        buffer = value.buffer;
        if (!(buffer instanceof ArrayBuffer)) {
          throw new Error(`writeValue needs an ArrayBuffer or View, was passed ${value}`);
        }
      }
      // Can't send raw array bytes since we use JSON, so base64 encode.
      let v64 = wbutils.arrayBufferToBase64(buffer);
      return this.sendMessage('writeCharacteristicValue', {data: {value: v64}});
    },
    startNotifications: function () {
      return this.sendMessage('startNotifications').then(() => this);
    },
    stopNotifications: function () {
      return this.sendMessage('stopNotifications').then(() => this);
    },
    sendMessage: function (type, messageParms) {
      messageParms = messageParms || {};
      messageParms.data = messageParms.data || {};
      messageParms.data.characteristicUUID = this.uuid;
      return this.service.sendMessage(type, messageParms);
    },
    toString: function () {
      return `BluetoothRemoteGATTCharacteristic(${this.service.toString()}, ${this.uuid})`;
    }
  };
  wbutils.mixin(BluetoothRemoteGATTCharacteristic, wbutils.EventTarget);

  nslog('Create BluetoothGATTDescriptor');
  function BluetoothGATTDescriptor(characteristic, uuid) {
    defineROProperties(this, {characteristic: characteristic, uuid: uuid});
  }

  BluetoothGATTDescriptor.prototype = {
    get writableAuxiliaries() {
      return this.value;
    },
    readValue: function () {
      throw new Error('Not implemented');
    },
    writeValue: function () {
      throw new Error('Not implemented');
    }
  };

  nslog('Create bluetooth');
  let bluetooth = {};
  bluetooth.requestDevice = function (requestDeviceOptions) {
    if (!requestDeviceOptions) {
      return Promise.reject(new TypeError('requestDeviceOptions not provided'));
    }
    let acceptAllDevices = requestDeviceOptions.acceptAllDevices;
    let filters = requestDeviceOptions.filters;
    if (acceptAllDevices) {
      if (filters && filters.length > 0) {
        return Promise.reject(new TypeError('acceptAllDevices was true but filters was not empty'));
      }
      return native.sendMessage(
        'requestDevice', {data: {acceptAllDevices: true}}
      ).then(function (device) {
        return new BluetoothDevice(device);
      });
    }

    if (!filters || filters.length === 0) {
      return Promise.reject(new TypeError('No filters provided and acceptAllDevices not set'));
    }
    try {
      filters = Array.prototype.map.call(filters, wbutils.canonicaliseFilter);
    } catch (e) {
      return Promise.reject(e);
    }
    let validatedDeviceOptions = {};
    validatedDeviceOptions.filters = filters;

    // Optional services not yet suppoprted.
    // let optionalServices = requestDeviceOptions.optionalServices;
    // if (optionalServices) {
    //     optionalServices = optionalServices.services.map(window.BluetoothUUID.getService);
    //     validatedDeviceOptions.optionalServices = optionalServices;
    // }
    return native.sendMessage(
      'requestDevice',
      {data: validatedDeviceOptions}
    ).then(function (device) {
      return new BluetoothDevice(device);
    });
  };

  function BluetoothEvent(type, target) {
    defineROProperties(this, {type, target, srcElement: target});
  }
  BluetoothEvent.prototype = {
    prototype: Event.prototype,
    constructor: BluetoothEvent
  };

  //
  // ===== Communication with Native =====
  //
  native = {
    messageCount: 0,
    callbacks: {}, // callbacks for responses to requests

    cancelTransaction: function (tid) {
      let trans = this.callbacks[tid];
      if (!trans) {
        nslog(`No transaction ${tid} outstanding to fail.`);
        return;
      }
      delete this.callbacks[tid];
      trans(false, 'Premature cancellation.');
    },
    getTransactionID: function () {
      let mc = this.messageCount;
      do {
        mc += 1;
      } while (native.callbacks[mc] !== undefined);
      this.messageCount = mc;
      return this.messageCount;
    },
    sendMessage: function (type, sendMessageParms) {
      let message;
      if (type === undefined) {
        throw new Error('CallRemote should never be called without a type!');
      }

      sendMessageParms = sendMessageParms || {};
      let data = sendMessageParms.data || {};
      let callbackID = sendMessageParms.callbackID || this.getTransactionID();
      message = {
        type: type,
        data: data,
        callbackID: callbackID
      };

      nslog(`${type} ${callbackID}`);
      window.webkit.messageHandlers.bluetooth.postMessage(message);

      this.messageCount += 1;
      return new Promise(function (resolve, reject) {
        native.callbacks[callbackID] = function (success, result) {
          if (success) {
            nslog(`${type} ${callbackID} success`);
            resolve(result);
          } else {
            nslog(`${type} ${callbackID} failure ${JSON.stringify(result)}`);
            reject(result);
          }
          delete native.callbacks[callbackID];
        };
      });
    },
    receiveMessageResponse: function (success, resultString, callbackID) {
      if (callbackID !== undefined && native.callbacks[callbackID]) {
        native.callbacks[callbackID](success, resultString);
      } else {
        nslog(`Response for unknown callbackID ${callbackID}`);
      }
    },
    // of shape {deviceId: BluetoothDevice}
    devicesBeingNotified: {},
    registerDeviceForNotifications: function (device) {
      let did = device.id;
      if (native.devicesBeingNotified[did] === undefined) {
        native.devicesBeingNotified[did] = [];
      }
      let devs = native.devicesBeingNotified[did];
      devs.forEach(function (dev) {
        if (dev === device) {
          throw new Error('Device already registered for notifications');
        }
      });
      nslog(`Register device ${did} for notifications`);
      devs.push(device);
    },
    unregisterDeviceForNotifications: function (device) {
      let did = device.id;
      if (native.devicesBeingNotified[did] === undefined) {
        return;
      }
      let devs = native.devicesBeingNotified[did];
      let ii;
      for (ii = 0; ii < devs.length; ii += 1) {
        if (devs[ii] === device) {
          devs.splice(ii, 1);
          return;
        }
      }
    },
    receiveDeviceDisconnectEvent: function (deviceId) {
      nslog(`${deviceId} disconnected`);
      let devices = native.devicesBeingNotified[deviceId];
      if (devices !== undefined) {
        devices.forEach(function (device) {
          device.handleSpontaneousDisconnectEvent();
          native.unregisterDeviceForNotifications(device);
        });
      }
      native.characteristicsBeingNotified[deviceId] = undefined;
    },
    // shape: {deviceUUID: {characteristicUUID: [BluetoothRemoteGATTCharacteristic]}}
    characteristicsBeingNotified: {},
    registerCharacteristicForNotifications: function (characteristic) {

      let did = characteristic.service.device.id;
      let cid = characteristic.uuid;
      nslog(`Registering char UUID ${cid} on device ${did}`);

      if (native.characteristicsBeingNotified[did] === undefined) {
        native.characteristicsBeingNotified[did] = {};
      }
      let chars = native.characteristicsBeingNotified[did];
      if (chars[cid] === undefined) {
        chars[cid] = [];
      }
      chars[cid].push(characteristic);
    },
    receiveCharacteristicValueNotification: function (deviceId, cname, d64) {
      nslog('receiveCharacteristicValueNotification');
      const cid = window.BluetoothUUID.getCharacteristic(cname);
      let devChars = native.characteristicsBeingNotified[deviceId];
      let chars = devChars && devChars[cid];
      if (chars === undefined) {
        nslog(
          'Unexpected characteristic value notification for device ' +
          `${deviceId} and characteristic ${cid}`
        );
        return;
      }
      nslog('<-- char val notification', cid, d64);
      chars.forEach(function (char) {
        let dataView = wbutils.str64todv(d64);
        char.value = dataView;
        char.dispatchEvent(new BluetoothEvent('characteristicvaluechanged', char));
      });
    },
    enableBluetooth: function () {
      // weirdly this can get overwritten, so add a way to enable it.
      navigator.bluetooth = bluetooth;
    },
    // defeat the linter's "out of scope" warnings for not yet defined functions
    BluetoothRemoteGATTCharacteristic: BluetoothRemoteGATTCharacteristic,
    BluetoothRemoteGATTServer: BluetoothRemoteGATTServer,
    BluetoothRemoteGATTService: BluetoothRemoteGATTService,
    BluetoothEvent: BluetoothEvent
  };

  // Exposed interfaces
  window.BluetoothDevice = BluetoothDevice;
  window.iOSNativeAPI = native;
  window.receiveDeviceDisconnectEvent = native.receiveDeviceDisconnectEvent;
  window.receiveMessageResponse = native.receiveMessageResponse;
  window.receiveCharacteristicValueNotification = native.receiveCharacteristicValueNotification;

  native.enableBluetooth();

  // Patches
  // Patch window.open so it doesn't attempt to open in a separate window or tab ever.
  function open(location) {
    window.location = location;
  }
  window.open = open;
  nslog('WBPolyfill complete');
}());
