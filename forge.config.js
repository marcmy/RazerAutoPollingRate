module.exports = {
  packagerConfig: {
    icon: 'src/assets/app',
    electronZipDir: process.env.ELECTRON_ZIP_DIR || undefined
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        options: {
          icon: 'src/assets/app'
        }
      }
    }
  ],
  publishers: [
    {
      name: '@electron-forge/publisher-github',
      config: {
        repository: {
          owner: process.env.GITHUB_REPOSITORY_OWNER || 'marcmy',
          name: 'RazerAutoPollingRate'
        },
        draft: true,
        prerelease: false
      }
    }
  ]
};
