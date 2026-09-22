let initialized = false;
const auth = require("../../../.idea/models/.svn/auth.store");

const initializeHandler = async () => {
  if (initialized) return;
  initialized = true;
};

// Call the initialization
initializeHandler();

// Export a higher-order function that wraps the module exports
const departmentModuleHandler = (moduleFactory) => {
  if (!initialized) {
    initializeHandler();
  }
  return moduleFactory();
};

module.exports = { departmentModuleHandler };

