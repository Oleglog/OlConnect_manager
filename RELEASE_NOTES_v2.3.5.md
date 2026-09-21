# OlConnect Manager server-v2.3.5 — Релиз: Перевод OpenFlux на нативный режим L3

Релиз **server-v2.3.5** переводит запуск выходных нод OpenFlux по умолчанию на производительный режим ядра **L3** (`--mode l3`).

---

### 🚀 Что нового

1. **Режим L3 по умолчанию для OpenFlux**:
   - В скриптах `olcrtc-launcher`, установщике `olcrtc-setup.sh` и создании инстансов в панели дефолтным режимом выбран `--mode l3` (вместо медленного эмулятора сокетов gVisor `--mode l4`).
   - Режим L3 передает пакеты напрямую через raw-сокеты ядра Linux (`syscall.SOCK_RAW`) с выделенными буферами 16 МБ и аппаратным NAT, устраняя искусственные ограничения TCP-окна gVisor и обеспечивая максимальную скорость загрузки медиа в Telegram, браузерах и стриминге.

---

### 📦 Инструкция по обновлению на VPS:
```bash
curl -fsSL https://raw.githubusercontent.com/Oleglog/OlConnect_manager/master/server-install/olcrtc-setup.sh | sudo bash -s -- --update
```
