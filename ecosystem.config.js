module.exports = {
    apps: [{
      name: 'wcrelay',
      script: './dist/index.js',
      watch: './dist',
      exec_mode: 'cluster',
      instances: 1,
      env: {
        "NODE_ENV": "production",
      },
      env_development: {
        "NODE_ENV": "development",
      },
      env_test: {
        "NODE_ENV": "test",
      }
    }],
  };
  