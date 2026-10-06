// Canh chừng: phát hiện sự cố khi không có ai ngồi trực và báo về điện thoại.
//  - Đang trong giờ mở cửa mà nguồn sự kiện mất kết nối / kênh chưa live
//  - Đã kết nối nhưng lâu không có sự kiện nào (kết nối "chết lâm sàng")
//  - Không có trang hiển thị nào đang mở (OBS tắt / browser source lỗi)

export class Watchdog {
  constructor({ config, sources, pipeline, scheduler, hub, alerts, locations, now = () => Date.now() }) {
    this.cfg = config.watchdog;
    this.sources = sources;
    this.pipeline = pipeline;
    this.scheduler = scheduler;
    this.hub = hub;
    this.alerts = alerts;
    this.locations = locations;
    this.now = now;
    this.noWorldSince = null;
  }

  start() {
    this.timer = setInterval(() => this.check(), (this.cfg.checkEverySec || 15) * 1000);
  }
  stop() {
    clearInterval(this.timer);
  }

  check() {
    const now = this.now();
    const open = Boolean(this.scheduler.current().location);
    const st = this.sources.status;
    const sec = (ms) => Math.round(ms / 1000);

    // 1. Nguồn sự kiện không kết nối trong giờ mở cửa
    const downFor = st.state === 'connected' ? 0 : now - (st.downSince ?? st.since);
    if (open && downFor >= this.cfg.sourceDownAlertSec * 1000) {
      const why = st.state === 'offline' ? 'kênh TikTok chưa phát live' : `nguồn "${st.source}" ${st.state}${st.detail ? ` (${st.detail})` : ''}`;
      this.alerts.raise('source', `Đang giờ mở cửa nhưng ${why} đã ${sec(downFor)} giây`, 'error');
    } else if (st.state === 'connected') {
      this.alerts.resolve('source', `Nguồn "${st.source}" đã kết nối lại`);
    } else if (!open) {
      this.alerts.resolve('source'); // hết giờ mở cửa: không cần báo nữa
    }

    // 2. Kết nối nhưng im lặng quá lâu
    const quietFor = now - Math.max(this.pipeline.lastEventAt, st.since);
    if (open && st.state === 'connected' && quietFor >= this.cfg.silentAlertSec * 1000) {
      this.alerts.raise('silent', `Đã ${sec(quietFor)} giây không nhận được sự kiện nào — kiểm tra live`, 'warn');
    } else if (quietFor < this.cfg.silentAlertSec * 1000) {
      this.alerts.resolve('silent', 'Đã nhận lại sự kiện từ live');
    }

    // 3. Không có trang hiển thị nào (OBS)
    if (open && this.hub.count('world') === 0) {
      this.noWorldSince ??= now;
      if (now - this.noWorldSince >= this.cfg.noWorldAlertSec * 1000) {
        this.alerts.raise('world', 'Không có trang hiển thị nào đang mở — kiểm tra OBS / browser source', 'error');
      }
    } else {
      this.noWorldSince = null;
      this.alerts.resolve('world', 'Trang hiển thị đã mở lại');
    }
  }
}
