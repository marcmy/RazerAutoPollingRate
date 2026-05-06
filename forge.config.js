module.exports = {
  packagerConfig: {
    icon: 'src/assets/app'
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
