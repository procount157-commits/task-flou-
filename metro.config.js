const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Load each module the first time it is used instead of all of them at launch:
// with twenty-odd screens and several heavy libraries, eager loading was most of the start-up time.
config.transformer.getTransformOptions = async () => ({
  transform: { experimentalImportSupport: false, inlineRequires: true },
});

module.exports = config;
