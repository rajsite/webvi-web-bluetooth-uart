(function () {
  'use strict';

  const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_TX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
  const NUS_RX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

  let bluetoothDevice = undefined;
  let txCharacteristic = undefined;
  let rxCharacteristic = undefined;
  let cleanupConnectionHelper = undefined;

  let logBuffer = [];
  let logBufferCallback = undefined;
  let log = function (line) {
    if (logBufferCallback) {
      logBufferCallback(line);
      logBufferCallback = undefined;
      return;
    }
    logBuffer.push(line);
  };

  let logTXBuffer = [];
  let logTXBufferCallback = undefined;
  let logTX = function (line) {
    if (logTXBufferCallback) {
      logTXBufferCallback(line);
      logTXBufferCallback = undefined;
    }
    logTXBuffer.push(line);
  };

  // These two function will block forever until a message comes,
  // not the greatest but good enough for now
  window.readLogMessage = function (jsAPI) {
    if (logBufferCallback) {
      throw new Error('Pending readLogMessage exists, multiple calls not implemented');
    }
    if (logBuffer.length > 0) {
      return logBuffer.shift();
    }
    logBufferCallback = jsAPI.getCompletionCallback();
    return undefined;
  };

  window.readTXMessage = function (jsAPI) {
    if (logTXBufferCallback) {
      throw new Error('Pending readTXMessage exists, multiple calls not implemented');
    }
    if (logTXBuffer.length > 0) {
      return logTXBuffer.shift();
    }
    logTXBufferCallback = jsAPI.getCompletionCallback();
    return undefined;
  };

  let isWebBluetoothEnabled = function () {
    if (navigator.bluetooth) {
      return true;
    }

    log('Web Bluetooth API is not available.\n' +
        'Please make sure the Web Bluetooth flag is enabled.');
    return false;
  };

  let connectToDevice = function () {
    let txValueChangeHandler = function (event) {
      let value = event.target.value;
      let result = '';
      for (let i = 0; i < value.byteLength; i++) {
        result += String.fromCharCode(value.getUint8(i));
      }
      logTX(result);
    };

    let cleanupConnection = function () {
      if (txCharacteristic) {
        log('Stopping notifications...');
        try {
          txCharacteristic.removeEventListener('characteristicvaluechanged', txValueChangeHandler);
        } catch (error) {
          log('Argh! ' + error);
        }
        txCharacteristic = undefined;
      }
      if (rxCharacteristic) {
        log('Freeing rx connection...');
        rxCharacteristic = undefined;
      }
      if (bluetoothDevice) {
        if (bluetoothDevice.gatt.connected) {
          log('Disconnecting from Bluetooth Device...');
          bluetoothDevice.gatt.disconnect();
        }
        bluetoothDevice = undefined;
      }
      if (cleanupConnectionHelper) {
        cleanupConnectionHelper = undefined;
      }
    };

    log('Requesting Bluetooth Device...');
    return navigator.bluetooth.requestDevice({
      filters: [{
        services: [NUS_SERVICE_UUID]
      }]
    }).then(device => {
      bluetoothDevice = device;
      bluetoothDevice.addEventListener('gattserverdisconnected', cleanupConnection);
      log('Connecting to GATT Server...');
      return device.gatt.connect();
    }).then(server => {
      log('Getting Service...');
      return server.getPrimaryService(NUS_SERVICE_UUID);
    }).then(service => {
      log('Getting Characteristics...');
      return Promise.all([
        service.getCharacteristic(NUS_TX_CHARACTERISTIC_UUID).then(txchar => {
          txCharacteristic = txchar;
          log('Tx charactersitic obtained');
          return txCharacteristic.startNotifications().then(() => {
            log('Tx Notifications started');
            txCharacteristic.addEventListener('characteristicvaluechanged', txValueChangeHandler);
          });
        }),
        service.getCharacteristic(NUS_RX_CHARACTERISTIC_UUID).then(rxchar => {
          rxCharacteristic = rxchar;
          log('Rx charactersitic obtained');
        })
      ]);
    }).then(() => {
      log('Creating Close connection helper for future use...');
      cleanupConnectionHelper = cleanupConnection;
      return;
    });
  };

  window.selectButtonAndWaitForDevice = function (selector, jsAPI) {
    let cb = jsAPI.getCompletionCallback();
    if (!isWebBluetoothEnabled()) {
      cb(false);
      return;
    }

    let button = document.querySelector(selector);
    if (button === null) {
      log('Could not find button with selector: ' + selector);
      cb(false);
      return;
    }

    let buttonHandler = function (evt) {
      evt.stopPropagation();
      evt.preventDefault();
      button.removeEventListener('click', buttonHandler);

      connectToDevice().then(() => {
        cb(true);
      }).catch(error => {
        log('Connecting to device to device... Argh! ' + error);
        cb(false);
      });
    };

    button.addEventListener('click', buttonHandler);
  };

  // Some messages sent: 'ID', 'GetIP', 'Status'
  window.sendRXMessage = function (message) {
    let str2ab = function (str) {
      let buf = new ArrayBuffer(str.length);
      let bufView = new Uint8Array(buf);
      for (let i = 0, strLen = str.length; i < strLen; i++) {
        bufView[i] = str.charCodeAt(i);
      }
      return buf;
    };

    if (isWebBluetoothEnabled() && rxCharacteristic) {
      log('Sending string via RX characteristic...');
      rxCharacteristic.writeValue(str2ab(message));
    }
  };

  window.closeDevice = function () {
    if (isWebBluetoothEnabled() && cleanupConnectionHelper) {
      log('Closing connection to device...');
      cleanupConnectionHelper();
    }
  };
}());
