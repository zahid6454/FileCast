(function () {
  'use strict';

  window.convertText = function (text) {
    var data = JSON.parse(text);
    var yaml = toYaml(data, 0);
    return { text: yaml, filename: 'data.yaml' };
  };

  function toYaml(value, indent) {
    var prefix = rpt('  ', indent);

    if (value === null || value === undefined) return 'null\n';
    if (typeof value === 'boolean') return (value ? 'true' : 'false') + '\n';
    if (typeof value === 'number') return String(value) + '\n';

    if (typeof value === 'string') {
      if (
        value === '' ||
        value.indexOf('\n') !== -1 ||
        value.indexOf(':') !== -1 ||
        value.indexOf('#') !== -1 ||
        value.indexOf('{') !== -1 ||
        value.indexOf('[') !== -1 ||
        value.indexOf('"') !== -1 ||
        value.indexOf("'") !== -1 ||
        value === 'true' ||
        value === 'false' ||
        value === 'null' ||
        (!isNaN(value) && value.trim() !== '')
      ) {
        return JSON.stringify(value) + '\n';
      }
      return value + '\n';
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]\n';
      var out = '\n';
      value.forEach(function (item) {
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          var keys = Object.keys(item);
          out += prefix + '- ' + keys[0] + ': ' + toYaml(item[keys[0]], indent + 2).trimStart();
          for (var k = 1; k < keys.length; k++) {
            out += prefix + '  ' + keys[k] + ': ' + toYaml(item[keys[k]], indent + 2).trimStart();
          }
        } else {
          out += prefix + '- ' + toYaml(item, indent + 1).trimStart();
        }
      });
      return out;
    }

    if (typeof value === 'object') {
      var objKeys = Object.keys(value);
      if (objKeys.length === 0) return '{}\n';
      var result = '\n';
      objKeys.forEach(function (key) {
        var safeKey = key;
        if (key.indexOf(':') !== -1 || key.indexOf('#') !== -1 || key.indexOf(' ') !== -1) {
          safeKey = JSON.stringify(key);
        }
        result += prefix + safeKey + ': ' + toYaml(value[key], indent + 1).trimStart();
      });
      return result;
    }

    return String(value) + '\n';
  }

  function rpt(str, n) {
    var out = '';
    for (var i = 0; i < n; i++) out += str;
    return out;
  }
})();
