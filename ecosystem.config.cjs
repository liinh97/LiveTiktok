// Chạy bằng pm2 để tự khởi động lại khi lỗi / khi máy khởi động lại:
//   npm i -g pm2 && pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'live-world',
      script: 'src/index.js',
      node_args: '--env-file-if-exists=.env --disable-warning=ExperimentalWarning',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '500M',
      time: true,
    },
  ],
};
